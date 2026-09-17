// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/lib/passwordSecurity";
import {
  appendRoomEvent,
  createRoom,
  endRoom,
  joinRoomGuest,
  readRoom,
  readRoomEvents,
  roomPaths,
  RoomStoreError,
  rotateRoomInvite,
  verifyRoomPassword,
} from "@/lib/roomStore";
import {
  resolveRoomInvite,
  resolveGuestSession,
  issueGuestSession,
} from "@/lib/guestSession";
import { accountTenantDataRoot, runWithAccountTenantData } from "@/lib/tenantDataContext";

const HOST = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-09-15T01:00:00.000Z";

let originalCwd: string;
let workDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "room-store-"));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

function inHost<T>(task: () => Promise<T>): Promise<T> {
  return runWithAccountTenantData(HOST, task);
}

describe("room store", () => {
  it("creates a room under the host tenant with a hashed invite and registers the token globally", async () => {
    const created = await inHost(() => createRoom({
      hostAccountId: HOST,
      mode: "remote",
      title: "Vision 정기 미팅",
      host: { name: "김민수", language: "ko" },
      now: NOW,
    }));

    expect(created.invite.password).toMatch(/^[A-Za-z2-9]{8}$/u);
    expect(created.invite.token).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
    const paths = roomPaths(created.room.id, accountTenantDataRoot(HOST));
    expect(existsSync(paths.room)).toBe(true);
    const stored = JSON.parse(await readFile(paths.room, "utf8"));
    expect(stored.invite.password.algorithm).toBe("scrypt-v1");
    expect(JSON.stringify(stored)).not.toContain(created.invite.password);
    expect(JSON.stringify(stored)).not.toContain(created.invite.token);
    expect(created.room.participants).toEqual([
      { role: "host", name: "김민수", language: "ko", speakerLabel: null, joinedAt: NOW },
    ]);
    // The invite index lives in the global system root so a join link can be
    // resolved before any tenant context exists.
    await expect(resolveRoomInvite(created.invite.token)).resolves.toEqual({
      hostAccountId: HOST,
      meetingId: created.room.id,
    });
    expect(existsSync(join(workDir, "data", "system", "room-access.json"))).toBe(true);
  });

  it("verifies the password without exposing whether the room exists", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    await expect(inHost(() => verifyRoomPassword(created.room.id, created.invite.password))).resolves.toBe(true);
    await expect(inHost(() => verifyRoomPassword(created.room.id, "wrong-pass"))).resolves.toBe(false);
    await expect(inHost(() => verifyRoomPassword("missing-room", created.invite.password))).resolves.toBe(false);
  });

  it("seats the guest once, records the join event, and replaces the seat on rejoin", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    const joined = await inHost(() => joinRoomGuest(created.room.id, { name: "Alex", language: "en", now: "2026-09-15T01:05:00.000Z" }));
    expect(joined.participants).toHaveLength(2);
    expect(joined.participants[1]).toMatchObject({ role: "guest", name: "Alex", language: "en" });

    const rejoined = await inHost(() => joinRoomGuest(created.room.id, { name: "Alex K", language: "ja", now: "2026-09-15T01:06:00.000Z" }));
    expect(rejoined.participants).toHaveLength(2);
    expect(rejoined.participants[1]).toMatchObject({ name: "Alex K", language: "ja" });

    const { events } = await inHost(() => readRoomEvents(created.room.id));
    expect(events.map((event) => event.type)).toEqual(["participant", "participant"]);
    expect(events[0]).toMatchObject({ seq: 1, type: "participant", state: "joined", name: "Alex" });
    expect(events[1]).toMatchObject({ seq: 2, type: "participant", state: "joined", name: "Alex K" });
  });

  it("appends events with monotonically increasing seq and replays after a given seq", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    const id = created.room.id;
    const first = await inHost(() => appendRoomEvent(id, {
      type: "utterance", utteranceId: "u1", speaker: "host", origin: "host", sourceLanguage: "ko",
      original: "안녕하세요", speakerLabel: null, confidence: "high",
    }));
    const second = await inHost(() => appendRoomEvent(id, { type: "translation", utteranceId: "u1", language: "en", text: "Hello" }));
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(Date.parse(second.at)).toBeGreaterThanOrEqual(Date.parse(first.at));

    const raw = await readFile(roomPaths(id, accountTenantDataRoot(HOST)).events, "utf8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(2);

    await expect(inHost(() => readRoomEvents(id, { afterSeq: 1 }))).resolves.toEqual({
      events: [second],
      corrupt: false,
    });
  });

  it("serializes concurrent appends so seq never collides", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    const id = created.room.id;
    const results = await inHost(() => Promise.all(Array.from({ length: 12 }, (_, index) =>
      appendRoomEvent(id, { type: "translation", utteranceId: `u${index}`, language: "en", text: `t${index}` }),
    )));
    expect(results.map((event) => event.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    const { events } = await inHost(() => readRoomEvents(id));
    expect(events).toHaveLength(12);
  });

  it("stops reading at the first corrupt line and reports it instead of guessing", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    const id = created.room.id;
    await inHost(() => appendRoomEvent(id, { type: "translation", utteranceId: "u1", language: "en", text: "one" }));
    const paths = roomPaths(id, accountTenantDataRoot(HOST));
    await appendFile(paths.events, "{not json\n");
    await appendFile(paths.events, `${JSON.stringify({ seq: 3, at: NOW, type: "translation", utteranceId: "u3", language: "en", text: "three" })}\n`);

    const result = await inHost(() => readRoomEvents(id));
    expect(result.corrupt).toBe(true);
    expect(result.events.map((event) => event.seq)).toEqual([1]);
    await expect(inHost(() => appendRoomEvent(id, { type: "translation", utteranceId: "u4", language: "en", text: "four" })))
      .rejects.toMatchObject({ code: "events_corrupt" });
  });

  it("ends the room once, computes the 24-hour guest window, and refuses new utterances afterwards", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    const id = created.room.id;
    const ended = await inHost(() => endRoom(id, { now: "2026-09-15T02:00:00.000Z" }));
    expect(ended.endedAt).toBe("2026-09-15T02:00:00.000Z");
    expect(ended.guestExpiresAt).toBe("2026-09-16T02:00:00.000Z");
    const again = await inHost(() => endRoom(id, { now: "2026-09-15T03:00:00.000Z" }));
    expect(again.endedAt).toBe("2026-09-15T02:00:00.000Z");
    const { events } = await inHost(() => readRoomEvents(id));
    expect(events.filter((event) => event.type === "ended")).toHaveLength(1);
    await expect(inHost(() => appendRoomEvent(id, {
      type: "utterance", utteranceId: "late", speaker: "host", origin: "host", sourceLanguage: "ko",
      original: "늦은 발화", speakerLabel: null, confidence: "high",
    }))).rejects.toMatchObject({ code: "room_ended" });
  });

  it("rotating the invite issues a new password and token and revokes existing guest sessions", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    const id = created.room.id;
    const session = await issueGuestSession({
      inviteToken: created.invite.token,
      name: "Alex",
      language: "en",
      expiresAt: "2026-09-18T01:00:00.000Z",
    });
    await expect(resolveGuestSession(session.token)).resolves.toMatchObject({ meetingId: id, name: "Alex" });

    const rotated = await inHost(() => rotateRoomInvite(id, { now: "2026-09-15T01:30:00.000Z" }));
    expect(rotated.invite.token).not.toBe(created.invite.token);
    expect(rotated.invite.password).not.toBe(created.invite.password);
    const stored = await inHost(() => readRoom(id));
    expect(stored?.invite.rotatedAt).toBe("2026-09-15T01:30:00.000Z");
    await expect(verifyPassword(rotated.invite.password, stored!.invite.password)).resolves.toBe(true);
    await expect(resolveRoomInvite(created.invite.token)).resolves.toBeNull();
    await expect(resolveRoomInvite(rotated.invite.token)).resolves.toEqual({ hostAccountId: HOST, meetingId: id });
    await expect(resolveGuestSession(session.token)).resolves.toBeNull();
  });

  it("binds a diarization label to a seat, moves a label re-registered elsewhere, and refuses after the end", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "same_room", host: { name: "A", language: "ko" }, now: NOW }));
    const id = created.room.id;
    await inHost(() => joinRoomGuest(id, { name: "Alex", language: "en", now: NOW }));
    const { registerParticipantSpeakerLabel } = await import("@/lib/roomStore");
    const first = await inHost(() => registerParticipantSpeakerLabel(id, "host", "1", { now: NOW }));
    expect(first.participants.map((item) => [item.role, item.speakerLabel])).toEqual([["host", "1"], ["guest", null]]);
    const second = await inHost(() => registerParticipantSpeakerLabel(id, "guest", "2", { now: NOW }));
    expect(second.participants.map((item) => [item.role, item.speakerLabel])).toEqual([["host", "1"], ["guest", "2"]]);
    const moved = await inHost(() => registerParticipantSpeakerLabel(id, "guest", "1", { now: NOW }));
    expect(moved.participants.map((item) => [item.role, item.speakerLabel])).toEqual([["host", null], ["guest", "1"]]);
    const { events } = await inHost(() => readRoomEvents(id));
    expect(events.filter((event) => event.type === "participant" && event.state === "registered")).toHaveLength(3);
    await inHost(() => endRoom(id, { now: "2026-09-15T02:00:00.000Z" }));
    await expect(inHost(() => registerParticipantSpeakerLabel(id, "host", "3"))).rejects.toMatchObject({ code: "room_ended" });
  });

  it("fails closed on a corrupt room document", async () => {
    const created = await inHost(() => createRoom({ hostAccountId: HOST, mode: "remote", host: { name: "A", language: "ko" }, now: NOW }));
    await writeFile(roomPaths(created.room.id, accountTenantDataRoot(HOST)).room, "{\"schemaVersion\":1}");
    await expect(inHost(() => readRoom(created.room.id))).rejects.toBeInstanceOf(RoomStoreError);
    await expect(inHost(() => readRoom("no-such-room"))).resolves.toBeNull();
  });
});
