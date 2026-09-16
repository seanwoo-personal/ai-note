import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RoomLanguage } from "@/domain/room";
import { consumeAccountRateLimit } from "@/lib/accountRateLimit";
import { accountDataRoot } from "@/lib/accountStore";
import { atomicWriteFile } from "@/lib/atomicWrite";

// Guest access for shared interpreter rooms (ADR 0028). A join link carries only
// an invite token, so the token → (host account, meeting) index and the guest
// sessions live in the GLOBAL system root: middleware and the join route must
// resolve them before any tenant context exists. Only hashes are stored.
// Single writer: this module, serialized through one process-local queue.

export const GUEST_SESSION_COOKIE = "vision_guest_session";

export const ROOM_JOIN_MAX_ATTEMPTS = 5;
export const ROOM_JOIN_WINDOW_MS = 10 * 60 * 1_000;

interface InviteRecord {
  tokenHash: string;
  hostAccountId: string;
  meetingId: string;
  createdAt: string;
  expiresAt: string;
}

interface GuestSessionRecord {
  tokenHash: string;
  hostAccountId: string;
  meetingId: string;
  name: string;
  language: RoomLanguage;
  createdAt: string;
  expiresAt: string;
}

interface RoomAccessDocument {
  version: 1;
  invites: InviteRecord[];
  sessions: GuestSessionRecord[];
}

export interface ResolvedGuestSession {
  hostAccountId: string;
  meetingId: string;
  name: string;
  language: RoomLanguage;
  expiresAt: string;
}

export class GuestSessionError extends Error {
  readonly code: "invite_invalid" | "store_corrupt";

  constructor(code: "invite_invalid" | "store_corrupt") {
    super(code);
    this.name = "GuestSessionError";
    this.code = code;
  }
}

function storePath(root = accountDataRoot()): string {
  return join(root, "room-access.json");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function emptyDocument(): RoomAccessDocument {
  return { version: 1, invites: [], sessions: [] };
}

function normalize(value: unknown): RoomAccessDocument {
  if (!value || typeof value !== "object") throw new GuestSessionError("store_corrupt");
  const document = value as Partial<RoomAccessDocument>;
  if (document.version !== 1 || !Array.isArray(document.invites) || !Array.isArray(document.sessions)) {
    throw new GuestSessionError("store_corrupt");
  }
  return document as RoomAccessDocument;
}

async function readDocument(root: string): Promise<RoomAccessDocument> {
  try {
    return normalize(JSON.parse(await readFile(storePath(root), "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDocument();
    if (error instanceof GuestSessionError) throw error;
    throw new GuestSessionError("store_corrupt");
  }
}

let queue: Promise<unknown> = Promise.resolve();

async function mutate<T>(mutation: (document: RoomAccessDocument) => T | Promise<T>): Promise<T> {
  const root = accountDataRoot();
  const run = queue.catch(() => undefined).then(async () => {
    const document = await readDocument(root);
    const result = await mutation(document);
    document.invites = document.invites.slice(-5_000);
    document.sessions = document.sessions.slice(-10_000);
    await atomicWriteFile(storePath(root), `${JSON.stringify(document, null, 2)}\n`);
    return result;
  });
  queue = run;
  return run;
}

export async function registerRoomInvite(input: {
  token: string;
  hostAccountId: string;
  meetingId: string;
  expiresAt: string;
  now?: string;
}): Promise<void> {
  await mutate((document) => {
    document.invites = document.invites.filter((item) => item.meetingId !== input.meetingId);
    document.invites.push({
      tokenHash: tokenHash(input.token),
      hostAccountId: input.hostAccountId,
      meetingId: input.meetingId,
      createdAt: input.now ?? new Date().toISOString(),
      expiresAt: input.expiresAt,
    });
  });
}

/** Replace a room's invite (rotation) and revoke every guest session for it. */
export async function replaceRoomInvite(input: {
  token: string;
  hostAccountId: string;
  meetingId: string;
  expiresAt: string;
  now?: string;
}): Promise<void> {
  await mutate((document) => {
    document.invites = document.invites.filter((item) => item.meetingId !== input.meetingId);
    document.sessions = document.sessions.filter((item) => item.meetingId !== input.meetingId);
    document.invites.push({
      tokenHash: tokenHash(input.token),
      hostAccountId: input.hostAccountId,
      meetingId: input.meetingId,
      createdAt: input.now ?? new Date().toISOString(),
      expiresAt: input.expiresAt,
    });
  });
}

export async function resolveRoomInvite(token: string, nowIso = new Date().toISOString()): Promise<{ hostAccountId: string; meetingId: string } | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const document = await readDocument(accountDataRoot());
  const invite = document.invites.find((item) => item.tokenHash === hash);
  if (!invite || Date.parse(invite.expiresAt) <= Date.parse(nowIso)) return null;
  return { hostAccountId: invite.hostAccountId, meetingId: invite.meetingId };
}

export async function findRoomInviteHost(meetingId: string): Promise<string | null> {
  const document = await readDocument(accountDataRoot());
  return document.invites.find((item) => item.meetingId === meetingId)?.hostAccountId ?? null;
}

export async function updateRoomInviteExpiry(meetingId: string, expiresAt: string): Promise<void> {
  await mutate((document) => {
    for (const invite of document.invites) {
      if (invite.meetingId === meetingId) invite.expiresAt = expiresAt;
    }
  });
}

export async function issueGuestSession(input: {
  inviteToken: string;
  name: string;
  language: RoomLanguage;
  expiresAt: string;
  now?: string;
}): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  return mutate((document) => {
    const now = input.now ?? new Date().toISOString();
    const invite = document.invites.find((item) => item.tokenHash === tokenHash(input.inviteToken));
    if (!invite || Date.parse(invite.expiresAt) <= Date.parse(now)) throw new GuestSessionError("invite_invalid");
    document.sessions.push({
      tokenHash: tokenHash(token),
      hostAccountId: invite.hostAccountId,
      meetingId: invite.meetingId,
      name: input.name,
      language: input.language,
      createdAt: now,
      expiresAt: input.expiresAt,
    });
    return { token, expiresAt: input.expiresAt };
  });
}

export async function resolveGuestSession(token: string, nowIso = new Date().toISOString()): Promise<ResolvedGuestSession | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const document = await readDocument(accountDataRoot());
  const session = document.sessions.find((item) => item.tokenHash === hash);
  if (!session || Date.parse(session.expiresAt) <= Date.parse(nowIso)) return null;
  return {
    hostAccountId: session.hostAccountId,
    meetingId: session.meetingId,
    name: session.name,
    language: session.language,
    expiresAt: session.expiresAt,
  };
}

/** After the host ends a room, no guest session may outlive the download window. */
export async function capGuestSessions(meetingId: string, expiresAt: string): Promise<void> {
  await mutate((document) => {
    for (const session of document.sessions) {
      if (session.meetingId === meetingId && Date.parse(session.expiresAt) > Date.parse(expiresAt)) {
        session.expiresAt = expiresAt;
      }
    }
  });
}

export async function revokeGuestSessions(meetingId: string): Promise<void> {
  await mutate((document) => {
    document.sessions = document.sessions.filter((item) => item.meetingId !== meetingId);
  });
}

export async function sweepRoomAccess(nowIso = new Date().toISOString()): Promise<{ invites: number; sessions: number }> {
  const now = Date.parse(nowIso);
  return mutate((document) => {
    const invitesBefore = document.invites.length;
    const sessionsBefore = document.sessions.length;
    document.invites = document.invites.filter((item) => Date.parse(item.expiresAt) > now);
    document.sessions = document.sessions.filter((item) => Date.parse(item.expiresAt) > now);
    return { invites: invitesBefore - document.invites.length, sessions: sessionsBefore - document.sessions.length };
  });
}

/** Five password attempts per invite per ten minutes; key is the invite token hash. */
export function consumeRoomJoinAttempt(inviteKey: string): boolean {
  return consumeAccountRateLimit(`room-join:${inviteKey}`, ROOM_JOIN_MAX_ATTEMPTS, ROOM_JOIN_WINDOW_MS);
}
