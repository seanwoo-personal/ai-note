import { randomInt } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  attributeUtterance,
  buildInviteText,
  computeAutoEndAt,
  computeGuestExpiresAt,
  generateInvitePassword,
  isGuestAccessOpen,
  parseRoomDocument,
  parseRoomEvent,
  ROOM_AUTO_END_MS,
  ROOM_GUEST_ACCESS_MS,
  type RoomDocument,
  type RoomParticipant,
} from "@/domain/room";

const host: RoomParticipant = { role: "host", name: "김민수", language: "ko", speakerLabel: null, joinedAt: "2026-09-15T01:00:00.000Z" };
const guest: RoomParticipant = { role: "guest", name: "Alex", language: "en", speakerLabel: null, joinedAt: "2026-09-15T01:01:00.000Z" };

function room(overrides: Partial<RoomDocument> = {}): RoomDocument {
  return {
    schemaVersion: 1,
    id: "room-1",
    mode: "remote",
    title: null,
    createdAt: "2026-09-15T01:00:00.000Z",
    endedAt: null,
    guestExpiresAt: null,
    invite: {
      tokenHash: "a".repeat(43),
      password: { algorithm: "scrypt-v1", salt: "s", hash: "h" },
      rotatedAt: "2026-09-15T01:00:00.000Z",
    },
    participants: [host, guest],
    ...overrides,
  };
}

describe("room lifecycle timing", () => {
  it("opens guest access for 24 hours after the host ends the meeting", () => {
    expect(ROOM_GUEST_ACCESS_MS).toBe(24 * 60 * 60 * 1_000);
    expect(computeGuestExpiresAt("2026-09-15T10:00:00.000Z")).toBe("2026-09-16T10:00:00.000Z");
  });

  it("auto-ends a forgotten room 72 hours after creation", () => {
    expect(ROOM_AUTO_END_MS).toBe(72 * 60 * 60 * 1_000);
    expect(computeAutoEndAt("2026-09-15T01:00:00.000Z")).toBe("2026-09-18T01:00:00.000Z");
  });

  it("keeps guest access open while the room is running and until the post-end window closes", () => {
    const running = room();
    expect(isGuestAccessOpen(running, "2026-09-17T23:59:59.000Z")).toBe(true);
    const ended = room({ endedAt: "2026-09-15T10:00:00.000Z", guestExpiresAt: "2026-09-16T10:00:00.000Z" });
    expect(isGuestAccessOpen(ended, "2026-09-16T09:59:59.000Z")).toBe(true);
    expect(isGuestAccessOpen(ended, "2026-09-16T10:00:00.000Z")).toBe(false);
    expect(isGuestAccessOpen(running, "2026-09-18T01:00:00.000Z")).toBe(false);
  });
});

describe("speaker attribution", () => {
  it("uses the originating device in remote mode regardless of language", () => {
    const result = attributeUtterance({
      room: room({ mode: "remote" }),
      origin: "guest",
      sourceLanguage: "ko",
      speakerLabel: "1",
      previous: null,
    });
    expect(result).toEqual({ speaker: "guest", confidence: "high", rule: "origin" });
  });

  it("assigns by language when exactly one participant speaks that language in a shared room", () => {
    const result = attributeUtterance({
      room: room({ mode: "same_room" }),
      origin: "host",
      sourceLanguage: "en",
      speakerLabel: "2",
      previous: null,
    });
    expect(result).toEqual({ speaker: "guest", confidence: "high", rule: "language" });
  });

  it("falls back to a registered speaker label when both participants could own the language", () => {
    const registered = room({
      mode: "same_room",
      participants: [{ ...host, speakerLabel: "1" }, { ...guest, speakerLabel: "2" }],
    });
    const result = attributeUtterance({
      room: registered,
      origin: "host",
      sourceLanguage: "fr",
      speakerLabel: "2",
      previous: null,
    });
    expect(result).toEqual({ speaker: "guest", confidence: "high", rule: "registered_label" });
  });

  it("continues the previous speaker when the diarization label matches", () => {
    const result = attributeUtterance({
      room: room({ mode: "same_room" }),
      origin: "host",
      sourceLanguage: "fr",
      speakerLabel: "3",
      previous: { speaker: "guest", speakerLabel: "3" },
    });
    expect(result).toEqual({ speaker: "guest", confidence: "medium", rule: "label_continuity" });
  });

  it("marks low confidence and keeps the previous speaker when nothing distinguishes the utterance", () => {
    const result = attributeUtterance({
      room: room({ mode: "same_room" }),
      origin: "host",
      sourceLanguage: "fr",
      speakerLabel: null,
      previous: { speaker: "guest", speakerLabel: "3" },
    });
    expect(result).toEqual({ speaker: "guest", confidence: "low", rule: "fallback" });
    const first = attributeUtterance({
      room: room({ mode: "same_room" }),
      origin: "host",
      sourceLanguage: "fr",
      speakerLabel: null,
      previous: null,
    });
    expect(first).toEqual({ speaker: "host", confidence: "low", rule: "fallback" });
  });

  it("treats a shared language as ambiguous even when one participant is still missing", () => {
    const result = attributeUtterance({
      room: room({ mode: "same_room", participants: [host] }),
      origin: "host",
      sourceLanguage: "en",
      speakerLabel: null,
      previous: null,
    });
    expect(result.rule).toBe("fallback");
  });
});

describe("invite", () => {
  it("generates 8-character passwords from an unambiguous alphabet", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const password = generateInvitePassword(randomInt);
      expect(password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{8}$/u);
      seen.add(password);
    }
    expect(seen.size).toBeGreaterThan(190);
  });

  it("builds the three-line invite text with address, password, and the 24-hour policy", () => {
    const text = buildInviteText({ url: "https://note.example/join/abc", password: "Kx7pQ2mR" });
    expect(text.split("\n")).toEqual([
      "https://note.example/join/abc",
      "비밀번호: Kx7pQ2mR",
      "회의가 끝난 뒤 24시간 동안 열립니다.",
    ]);
  });
});

describe("schemas", () => {
  it("parses a v1 room document and rejects unknown fields or a second guest", () => {
    expect(parseRoomDocument(room())).toMatchObject({ id: "room-1", mode: "remote" });
    expect(() => parseRoomDocument({ ...room(), extra: true })).toThrow();
    expect(() => parseRoomDocument(room({ participants: [host, guest, { ...guest, name: "B" }] }))).toThrow();
    expect(() => parseRoomDocument(room({ participants: [guest] }))).toThrow();
  });

  it("parses each event kind and rejects a seq that is not a positive integer", () => {
    expect(parseRoomEvent({
      seq: 1, at: "2026-09-15T01:02:00.000Z", type: "utterance", utteranceId: "u1", speaker: "host", origin: "host",
      sourceLanguage: "ko", original: "안녕하세요", speakerLabel: null, confidence: "high",
    })).toMatchObject({ type: "utterance", speaker: "host" });
    expect(parseRoomEvent({ seq: 2, at: "2026-09-15T01:02:01.000Z", type: "translation", utteranceId: "u1", language: "en", text: "Hello" }))
      .toMatchObject({ type: "translation" });
    expect(parseRoomEvent({ seq: 3, at: "2026-09-15T01:02:02.000Z", type: "attribution", utteranceId: "u1", speaker: "guest" }))
      .toMatchObject({ type: "attribution" });
    expect(parseRoomEvent({ seq: 4, at: "2026-09-15T01:02:03.000Z", type: "participant", role: "guest", name: "Alex", language: "en", state: "joined" }))
      .toMatchObject({ type: "participant" });
    expect(parseRoomEvent({ seq: 5, at: "2026-09-15T01:02:04.000Z", type: "ended", endedAt: "2026-09-15T01:02:04.000Z" }))
      .toMatchObject({ type: "ended" });
    expect(() => parseRoomEvent({ seq: 0, at: "2026-09-15T01:02:04.000Z", type: "ended", endedAt: "2026-09-15T01:02:04.000Z" })).toThrow();
    expect(() => parseRoomEvent({ seq: 1, at: "x", type: "ended", endedAt: "2026-09-15T01:02:04.000Z" })).toThrow();
  });
});
