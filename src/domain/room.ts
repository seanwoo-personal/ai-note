import { z } from "zod";

// Shared interpreter room (ADR 0028): one host account, one guest, two
// language perspectives over a single event log. This module is pure — it
// owns the schemas, the lifecycle timing, and the speaker attribution rule.
// Filesystem access lives in src/lib/roomStore.ts and src/lib/guestSession.ts.

export const ROOM_LANGUAGES = ["ko", "en", "ja", "zh"] as const;
export type RoomLanguage = (typeof ROOM_LANGUAGES)[number];

export const ROOM_MODES = ["remote", "same_room"] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

export const ROOM_ROLES = ["host", "guest"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

/** Guest link stays valid this long after the host ends the meeting. */
export const ROOM_GUEST_ACCESS_MS = 24 * 60 * 60 * 1_000;
/** A room nobody ended is closed by the server this long after creation. */
export const ROOM_AUTO_END_MS = 72 * 60 * 60 * 1_000;

export const ROOM_INVITE_PASSWORD_LENGTH = 8;
// No 0/O, 1/l/I — the password is read aloud or copied from chat.
const INVITE_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

const isoDateTime = z.string().datetime({ offset: true });

const passwordRecordSchema = z.object({
  algorithm: z.literal("scrypt-v1"),
  salt: z.string().min(1),
  hash: z.string().min(1),
}).strict();

export const roomParticipantSchema = z.object({
  role: z.enum(ROOM_ROLES),
  name: z.string().min(1).max(40),
  language: z.enum(ROOM_LANGUAGES),
  /** Soniox diarization label registered for this participant (same_room only). */
  speakerLabel: z.string().min(1).max(16).nullable(),
  joinedAt: isoDateTime.nullable(),
}).strict();
export type RoomParticipant = z.infer<typeof roomParticipantSchema>;

export const roomDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  mode: z.enum(ROOM_MODES),
  title: z.string().max(200).nullable(),
  createdAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  guestExpiresAt: isoDateTime.nullable(),
  invite: z.object({
    tokenHash: z.string().min(1),
    password: passwordRecordSchema,
    rotatedAt: isoDateTime,
  }).strict(),
  participants: z.array(roomParticipantSchema).min(1).max(2),
}).strict().superRefine((value, context) => {
  const hosts = value.participants.filter((item) => item.role === "host").length;
  const guests = value.participants.filter((item) => item.role === "guest").length;
  if (hosts !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "exactly one host" });
  if (guests > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "at most one guest" });
});
export type RoomDocument = z.infer<typeof roomDocumentSchema>;

export function parseRoomDocument(input: unknown): RoomDocument {
  return roomDocumentSchema.parse(input);
}

const eventBase = {
  seq: z.number().int().positive(),
  at: isoDateTime,
};

export const roomEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("utterance"),
    utteranceId: z.string().min(1).max(64),
    speaker: z.enum(ROOM_ROLES),
    /** Which participant's device produced the audio; null when unknown. */
    origin: z.enum(ROOM_ROLES).nullable(),
    sourceLanguage: z.string().min(2).max(8),
    original: z.string().min(1).max(8_000),
    speakerLabel: z.string().min(1).max(16).nullable(),
    confidence: z.enum(["high", "medium", "low"]),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("translation"),
    utteranceId: z.string().min(1).max(64),
    language: z.enum(ROOM_LANGUAGES),
    text: z.string().min(1).max(8_000),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("attribution"),
    utteranceId: z.string().min(1).max(64),
    speaker: z.enum(ROOM_ROLES),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("participant"),
    role: z.enum(ROOM_ROLES),
    name: z.string().min(1).max(40),
    language: z.enum(ROOM_LANGUAGES),
    state: z.enum(["joined", "left", "language_changed"]),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("ended"),
    endedAt: isoDateTime,
  }).strict(),
]);
export type RoomEvent = z.infer<typeof roomEventSchema>;
export type RoomEventInput = RoomEvent extends infer E
  ? E extends { seq: number; at: string } ? Omit<E, "seq" | "at"> : never
  : never;

export function parseRoomEvent(input: unknown): RoomEvent {
  return roomEventSchema.parse(input);
}

export function computeGuestExpiresAt(endedAt: string): string {
  return new Date(Date.parse(endedAt) + ROOM_GUEST_ACCESS_MS).toISOString();
}

export function computeAutoEndAt(createdAt: string): string {
  return new Date(Date.parse(createdAt) + ROOM_AUTO_END_MS).toISOString();
}

/**
 * Guest access is open while the room is running (until the auto-end
 * deadline) and, after the host ends it, until the 24-hour download window
 * closes.
 */
export function isGuestAccessOpen(room: Pick<RoomDocument, "createdAt" | "endedAt" | "guestExpiresAt">, nowIso: string): boolean {
  const now = Date.parse(nowIso);
  if (room.endedAt === null) return now < Date.parse(computeAutoEndAt(room.createdAt));
  const expiresAt = room.guestExpiresAt ?? computeGuestExpiresAt(room.endedAt);
  return now < Date.parse(expiresAt);
}

export interface AttributionInput {
  room: Pick<RoomDocument, "mode" | "participants">;
  /** Participant whose device sent the utterance. */
  origin: RoomRole;
  sourceLanguage: string;
  speakerLabel: string | null;
  previous: { speaker: RoomRole; speakerLabel: string | null } | null;
}

export type AttributionRule = "origin" | "language" | "registered_label" | "label_continuity" | "fallback";

export interface AttributionResult {
  speaker: RoomRole;
  confidence: "high" | "medium" | "low";
  rule: AttributionRule;
}

/**
 * Speaker attribution ladder (ADR 0028 §3). Remote mode trusts the device.
 * A shared room walks: language → registered diarization label → label
 * continuity → low-confidence fallback that the UI asks the user to confirm.
 */
export function attributeUtterance(input: AttributionInput): AttributionResult {
  if (input.room.mode === "remote") {
    return { speaker: input.origin, confidence: "high", rule: "origin" };
  }
  const participants = input.room.participants;
  const languageOwners = participants.filter((item) => item.language === input.sourceLanguage);
  // The rule only decides when both seats are known; otherwise a shared
  // language would be silently pinned to whoever happens to be present.
  if (participants.length === 2 && languageOwners.length === 1) {
    return { speaker: languageOwners[0].role, confidence: "high", rule: "language" };
  }
  if (input.speakerLabel) {
    const registered = participants.find((item) => item.speakerLabel === input.speakerLabel);
    if (registered) return { speaker: registered.role, confidence: "high", rule: "registered_label" };
    if (input.previous?.speakerLabel === input.speakerLabel) {
      return { speaker: input.previous.speaker, confidence: "medium", rule: "label_continuity" };
    }
  }
  return { speaker: input.previous?.speaker ?? "host", confidence: "low", rule: "fallback" };
}

/** Pure: the caller supplies a CSPRNG index source (e.g. node:crypto randomInt). */
export function generateInvitePassword(randomIndex: (exclusiveMax: number) => number): string {
  let password = "";
  for (let index = 0; index < ROOM_INVITE_PASSWORD_LENGTH; index += 1) {
    password += INVITE_PASSWORD_ALPHABET[randomIndex(INVITE_PASSWORD_ALPHABET.length)];
  }
  return password;
}

export function buildInviteText(input: { url: string; password: string }): string {
  return [input.url, `비밀번호: ${input.password}`, "회의가 끝난 뒤 24시간 동안 열립니다."].join("\n");
}
