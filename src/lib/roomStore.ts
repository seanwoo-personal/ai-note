import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  computeAutoEndAt,
  computeGuestExpiresAt,
  generateInvitePassword,
  parseRoomDocument,
  parseRoomEvent,
  ROOM_GUEST_ACCESS_MS,
  type RoomDocument,
  type RoomEvent,
  type RoomEventInput,
  type RoomLanguage,
  type RoomMode,
} from "@/domain/room";
import { atomicWriteFile } from "@/lib/atomicWrite";
import {
  capGuestSessions,
  findRoomInviteHost,
  registerRoomInvite,
  replaceRoomInvite,
  updateRoomInviteExpiry,
} from "@/lib/guestSession";
import { assertSafeId } from "@/lib/meetingId";
import { publishRoomEvent } from "@/lib/roomEventHub";
import { hashPassword, verifyPassword } from "@/lib/passwordSecurity";
import { dataRoot, meetingDir } from "@/lib/paths";

// Shared interpreter room persistence (ADR 0028). A room is one meeting
// directory in the HOST tenant: `room.json` (metadata, hashed invite) and
// `room-events.jsonl` (the append-only event log that is the source of truth
// while the room runs). This module is the single writer of both files.
// `status.json` / transcript / summary are produced at end time by the existing
// global-meeting publisher, never here.

const ROOM_FILE = "room.json";
const EVENTS_FILE = "room-events.jsonl";
const MAX_EVENT_LINE_BYTES = 64 * 1024;

export type RoomStoreErrorCode =
  | "room_not_found"
  | "room_corrupt"
  | "room_ended"
  | "events_corrupt"
  | "invalid_input";

export class RoomStoreError extends Error {
  readonly code: RoomStoreErrorCode;

  constructor(code: RoomStoreErrorCode) {
    super(code);
    this.name = "RoomStoreError";
    this.code = code;
  }
}

export interface RoomPaths {
  dir: string;
  room: string;
  events: string;
}

export function roomPaths(id: string, root = dataRoot()): RoomPaths {
  const dir = join(root, "meetings", assertSafeId(id));
  return { dir, room: join(dir, ROOM_FILE), events: join(dir, EVENTS_FILE) };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Invite index expiry while the room runs: auto-end deadline + download window. */
function runningInviteExpiry(createdAt: string): string {
  return new Date(Date.parse(computeAutoEndAt(createdAt)) + ROOM_GUEST_ACCESS_MS).toISOString();
}

async function writeRoom(room: RoomDocument): Promise<void> {
  const validated = parseRoomDocument(room);
  await atomicWriteFile(roomPaths(validated.id).room, `${JSON.stringify(validated, null, 2)}\n`);
}

export async function readRoom(id: string): Promise<RoomDocument | null> {
  let raw: string;
  try {
    raw = await readFile(roomPaths(id).room, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new RoomStoreError("room_corrupt");
  }
  try {
    const parsed = parseRoomDocument(JSON.parse(raw) as unknown);
    if (parsed.id !== id) throw new Error("id_mismatch");
    return parsed;
  } catch {
    throw new RoomStoreError("room_corrupt");
  }
}

async function requireRoom(id: string): Promise<RoomDocument> {
  const room = await readRoom(id);
  if (!room) throw new RoomStoreError("room_not_found");
  return room;
}

export interface CreateRoomInput {
  hostAccountId: string;
  mode: RoomMode;
  title?: string | null;
  host: { name: string; language: RoomLanguage };
  id?: string;
  now?: string;
}

export interface RoomInvite {
  token: string;
  password: string;
}

export async function createRoom(input: CreateRoomInput): Promise<{ room: RoomDocument; invite: RoomInvite }> {
  const now = input.now ?? new Date().toISOString();
  const id = input.id ?? randomUUID();
  const token = newInviteToken();
  const password = generateInvitePassword(randomInt);
  const room: RoomDocument = parseRoomDocument({
    schemaVersion: 1,
    id,
    mode: input.mode,
    title: input.title?.trim() ? input.title.trim() : null,
    createdAt: now,
    endedAt: null,
    guestExpiresAt: null,
    invite: { tokenHash: tokenHash(token), password: await hashPassword(password), rotatedAt: now },
    participants: [{ role: "host", name: input.host.name, language: input.host.language, speakerLabel: null, joinedAt: now }],
  });
  const dir = meetingDir(id);
  await writeRoom(room);
  // Touch the log so seq/replay semantics start from an existing, empty file.
  const handle = await open(join(dir, EVENTS_FILE), "a");
  await handle.close();
  await registerRoomInvite({
    token,
    hostAccountId: input.hostAccountId,
    meetingId: id,
    expiresAt: runningInviteExpiry(now),
    now,
  });
  return { room, invite: { token, password } };
}

/** Constant shape whether the room is missing or the password is wrong. */
export async function verifyRoomPassword(id: string, password: string): Promise<boolean> {
  let room: RoomDocument | null;
  try {
    room = await readRoom(id);
  } catch {
    return false;
  }
  if (!room) return false;
  return verifyPassword(password, room.invite.password);
}

export async function joinRoomGuest(
  id: string,
  input: { name: string; language: RoomLanguage; now?: string },
): Promise<RoomDocument> {
  const now = input.now ?? new Date().toISOString();
  const room = await requireRoom(id);
  if (room.endedAt !== null) {
    // Re-entering after the end is allowed for downloads; the seat stays as is.
    return room;
  }
  const name = input.name.trim();
  if (name.length === 0) throw new RoomStoreError("invalid_input");
  const host = room.participants.find((item) => item.role === "host")!;
  const previousGuest = room.participants.find((item) => item.role === "guest") ?? null;
  const updated: RoomDocument = {
    ...room,
    participants: [
      host,
      { role: "guest", name, language: input.language, speakerLabel: previousGuest?.speakerLabel ?? null, joinedAt: now },
    ],
  };
  await writeRoom(updated);
  await appendRoomEvent(id, { type: "participant", role: "guest", name, language: input.language, state: "joined" }, { now, room: updated });
  return updated;
}

export async function rotateRoomInvite(id: string, options: { hostAccountId?: string; now?: string } = {}): Promise<{ room: RoomDocument; invite: RoomInvite }> {
  const now = options.now ?? new Date().toISOString();
  const room = await requireRoom(id);
  const token = newInviteToken();
  const password = generateInvitePassword(randomInt);
  const updated: RoomDocument = {
    ...room,
    invite: { tokenHash: tokenHash(token), password: await hashPassword(password), rotatedAt: now },
  };
  await writeRoom(updated);
  const hostAccountId = options.hostAccountId ?? (await findHostAccountId(id));
  await replaceRoomInvite({
    token,
    hostAccountId,
    meetingId: id,
    expiresAt: room.guestExpiresAt ?? runningInviteExpiry(room.createdAt),
    now,
  });
  return { room: updated, invite: { token, password } };
}

// The tenant root only encodes a hash of the host account; the invite index
// keeps the raw id, so recover it there when the caller did not pass it.
async function findHostAccountId(meetingId: string): Promise<string> {
  const hostAccountId = await findRoomInviteHost(meetingId);
  if (!hostAccountId) throw new RoomStoreError("room_not_found");
  return hostAccountId;
}

export async function endRoom(id: string, options: { now?: string } = {}): Promise<RoomDocument> {
  const now = options.now ?? new Date().toISOString();
  const room = await requireRoom(id);
  if (room.endedAt !== null) return room;
  const endedAt = now;
  const guestExpiresAt = computeGuestExpiresAt(endedAt);
  const updated: RoomDocument = { ...room, endedAt, guestExpiresAt };
  await writeRoom(updated);
  await appendRoomEvent(id, { type: "ended", endedAt }, { now, room: updated, allowEnded: true });
  await capGuestSessions(id, guestExpiresAt);
  await updateRoomInviteExpiry(id, guestExpiresAt);
  return updated;
}

interface EventLogReadResult {
  events: RoomEvent[];
  corrupt: boolean;
}

async function readEventLog(id: string): Promise<EventLogReadResult> {
  let raw: string;
  try {
    raw = await readFile(roomPaths(id).events, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], corrupt: false };
    return { events: [], corrupt: true };
  }
  const events: RoomEvent[] = [];
  let expectedSeq = 1;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    if (Buffer.byteLength(line) > MAX_EVENT_LINE_BYTES) return { events, corrupt: true };
    let event: RoomEvent;
    try {
      event = parseRoomEvent(JSON.parse(line) as unknown);
    } catch {
      return { events, corrupt: true };
    }
    if (event.seq !== expectedSeq) return { events, corrupt: true };
    events.push(event);
    expectedSeq += 1;
  }
  return { events, corrupt: false };
}

export async function readRoomEvents(id: string, options: { afterSeq?: number } = {}): Promise<EventLogReadResult> {
  const result = await readEventLog(id);
  const afterSeq = options.afterSeq ?? 0;
  return { events: result.events.filter((event) => event.seq > afterSeq), corrupt: result.corrupt };
}

// Appends are serialized per room path so seq stays gap-free under concurrency.
const appendQueues = new Map<string, Promise<unknown>>();

export async function appendRoomEvent(
  id: string,
  input: RoomEventInput,
  options: { now?: string; room?: RoomDocument; allowEnded?: boolean } = {},
): Promise<RoomEvent> {
  const paths = roomPaths(id);
  const previous = appendQueues.get(paths.events) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const room = options.room ?? (await requireRoom(id));
    if (room.endedAt !== null && !options.allowEnded) throw new RoomStoreError("room_ended");
    const log = await readEventLog(id);
    if (log.corrupt) throw new RoomStoreError("events_corrupt");
    const seq = (log.events.at(-1)?.seq ?? 0) + 1;
    const event = parseRoomEvent({ ...input, seq, at: options.now ?? new Date().toISOString() });
    const handle = await open(paths.events, "a");
    try {
      await handle.appendFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    publishRoomEvent(paths.events, event);
    return event;
  });
  appendQueues.set(paths.events, run);
  try {
    return await run;
  } finally {
    if (appendQueues.get(paths.events) === run) appendQueues.delete(paths.events);
  }
}
