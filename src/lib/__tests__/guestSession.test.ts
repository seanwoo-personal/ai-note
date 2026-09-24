// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  capGuestSessions,
  consumeRoomJoinAttempt,
  GUEST_SESSION_COOKIE,
  issueGuestSession,
  registerRoomInvite,
  resolveGuestSession,
  resolveRoomInvite,
  revokeGuestSessions,
  sweepRoomAccess,
} from "@/lib/guestSession";

const HOST = "11111111-1111-4111-8111-111111111111";

let originalCwd: string;
let workDir: string;

// The fixtures carry fixed September 2026 timestamps; pin the wall clock so the
// implementation's `new Date()` defaults stay inside that window forever.
const CLOCK = "2026-09-15T00:30:00.000Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "guest-session-"));
  process.chdir(workDir);
});

afterEach(() => {
  vi.useRealTimers();
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

describe("guest session store", () => {
  it("uses a cookie name distinct from the customer and admin cookies", () => {
    expect(GUEST_SESSION_COOKIE).toBe("vision_guest_session");
  });

  it("registers an invite by hash only and resolves it by the plain token", async () => {
    await registerRoomInvite({ token: "invite-token-A", hostAccountId: HOST, meetingId: "room-1", expiresAt: "2026-09-19T00:00:00.000Z" });
    const raw = await readFile(join(workDir, "data", "system", "room-access.json"), "utf8");
    expect(raw).not.toContain("invite-token-A");
    await expect(resolveRoomInvite("invite-token-A")).resolves.toEqual({ hostAccountId: HOST, meetingId: "room-1" });
    await expect(resolveRoomInvite("invite-token-B")).resolves.toBeNull();
    await expect(resolveRoomInvite("")).resolves.toBeNull();
  });

  it("issues a guest session bound to the invite's room and resolves it until expiry", async () => {
    await registerRoomInvite({ token: "invite-token-A", hostAccountId: HOST, meetingId: "room-1", expiresAt: "2026-09-19T00:00:00.000Z" });
    const session = await issueGuestSession({ inviteToken: "invite-token-A", name: "Alex", language: "en", expiresAt: "2026-09-18T00:00:00.000Z" });
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
    await expect(resolveGuestSession(session.token, "2026-09-17T23:59:59.000Z")).resolves.toEqual({
      hostAccountId: HOST,
      meetingId: "room-1",
      name: "Alex",
      language: "en",
      expiresAt: "2026-09-18T00:00:00.000Z",
    });
    await expect(resolveGuestSession(session.token, "2026-09-18T00:00:00.000Z")).resolves.toBeNull();
    await expect(resolveGuestSession("forged")).resolves.toBeNull();
    await expect(issueGuestSession({ inviteToken: "nope", name: "X", language: "ko", expiresAt: "2026-09-18T00:00:00.000Z" }))
      .rejects.toMatchObject({ code: "invite_invalid" });
  });

  it("caps sessions to the post-end window and revokes them on demand", async () => {
    await registerRoomInvite({ token: "invite-token-A", hostAccountId: HOST, meetingId: "room-1", expiresAt: "2026-09-19T00:00:00.000Z" });
    const session = await issueGuestSession({ inviteToken: "invite-token-A", name: "Alex", language: "en", expiresAt: "2026-09-18T00:00:00.000Z" });
    await capGuestSessions("room-1", "2026-09-16T02:00:00.000Z");
    await expect(resolveGuestSession(session.token, "2026-09-16T01:59:59.000Z")).resolves.not.toBeNull();
    await expect(resolveGuestSession(session.token, "2026-09-16T02:00:00.000Z")).resolves.toBeNull();
    await revokeGuestSessions("room-1");
    await expect(resolveGuestSession(session.token, "2026-09-15T00:00:00.000Z")).resolves.toBeNull();
  });

  it("sweeps expired invites and sessions without touching live ones", async () => {
    await registerRoomInvite({ token: "old", hostAccountId: HOST, meetingId: "room-old", expiresAt: "2026-09-10T00:00:00.000Z" });
    await registerRoomInvite({ token: "live", hostAccountId: HOST, meetingId: "room-live", expiresAt: "2026-09-19T00:00:00.000Z" });
    const stale = await issueGuestSession({ inviteToken: "live", name: "A", language: "ko", expiresAt: "2026-09-11T00:00:00.000Z" });
    const fresh = await issueGuestSession({ inviteToken: "live", name: "B", language: "ja", expiresAt: "2026-09-18T00:00:00.000Z" });

    const removed = await sweepRoomAccess("2026-09-15T00:00:00.000Z");
    expect(removed).toEqual({ invites: 1, sessions: 1 });
    await expect(resolveRoomInvite("old")).resolves.toBeNull();
    await expect(resolveRoomInvite("live")).resolves.not.toBeNull();
    await expect(resolveGuestSession(stale.token, "2026-09-15T00:00:00.000Z")).resolves.toBeNull();
    await expect(resolveGuestSession(fresh.token, "2026-09-15T00:00:00.000Z")).resolves.not.toBeNull();
  });

  it("rate limits join attempts per invite: five within ten minutes", () => {
    const key = `test-${Date.now()}`;
    for (let index = 0; index < 5; index += 1) expect(consumeRoomJoinAttempt(key)).toBe(true);
    expect(consumeRoomJoinAttempt(key)).toBe(false);
    expect(consumeRoomJoinAttempt(`${key}-other`)).toBe(true);
  });
});
