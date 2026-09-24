import { z } from "zod";

import { attributeUtterance, ROOM_LANGUAGES, type RoomEvent, type RoomLanguage, type RoomRole } from "@/domain/room";
import { recordRequestUsage } from "@/lib/accountUsage";
import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse, safeLog } from "@/lib/publicApi";
import { resolveRoomRequest, roomErrorResponse } from "@/lib/roomApi";
import { appendRoomEvent, readRoomEvents, RoomStoreError } from "@/lib/roomStore";
import { TRANSLATION_CONTEXT_LINES, translateText, type TranslationContextLine } from "@/lib/translation";

// POST /api/rooms/[id]/utterances — a participant's device submits one final
// utterance. The server decides the speaker (ADR 0028 §3), appends the
// utterance, and translates it into every other participant language in the
// background; translations arrive as their own events on the SSE stream.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const utteranceSchema = z.object({
  utteranceId: z.string().min(1).max(64),
  original: z.string().trim().min(1).max(4000),
  sourceLanguage: z.string().min(2).max(8),
  speakerLabel: z.string().min(1).max(16).nullable().optional(),
  /** Translation produced live by the capture session (two-way mode); stored as-is. */
  liveTranslation: z.object({
    language: z.enum(ROOM_LANGUAGES),
    text: z.string().trim().min(1).max(8_000),
  }).strict().optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const context = await resolveRoomRequest(request, (await params).id);
  if (!context.ok) return context.response;
  if (context.room.endedAt !== null) return publicErrorResponse("meeting_conflict", 409, { meetingId: context.id });

  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 16 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = utteranceSchema.safeParse(body);
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);

  const log = await readRoomEvents(context.id);
  if (log.corrupt) return publicErrorResponse("content_state_ambiguous", 409, { meetingId: context.id });
  if (log.events.some((event) => event.type === "utterance" && event.utteranceId === parsed.data.utteranceId)) {
    // Idempotent resend after a lost response.
    return jsonNoStore({ accepted: true, duplicate: true });
  }
  const previousUtterance = [...log.events].reverse().find((event) => event.type === "utterance");
  const previous = previousUtterance && previousUtterance.type === "utterance"
    ? { speaker: previousUtterance.speaker, speakerLabel: previousUtterance.speakerLabel }
    : null;
  const attribution = attributeUtterance({
    room: context.room,
    origin: context.identity.role,
    sourceLanguage: parsed.data.sourceLanguage,
    speakerLabel: parsed.data.speakerLabel ?? null,
    previous,
  });

  let appended;
  try {
    appended = await appendRoomEvent(context.id, {
      type: "utterance",
      utteranceId: parsed.data.utteranceId,
      speaker: attribution.speaker,
      origin: context.identity.role,
      sourceLanguage: parsed.data.sourceLanguage,
      original: parsed.data.original,
      speakerLabel: parsed.data.speakerLabel ?? null,
      confidence: attribution.confidence,
    });
  } catch (error) {
    return roomErrorResponse(error, context.id);
  }

  const live = parsed.data.liveTranslation;
  if (live && live.language !== parsed.data.sourceLanguage) {
    try {
      await appendRoomEvent(context.id, { type: "translation", utteranceId: parsed.data.utteranceId, language: live.language, text: live.text });
    } catch (error) {
      return roomErrorResponse(error, context.id);
    }
  }
  // Every other participant language is (re)translated with the preceding
  // utterances as context. The live text above is the instant answer; the
  // refinement replaces it a few seconds later so breath-broken fragments read
  // as one sentence and references resolve.
  const targets = [...new Set(context.room.participants.map((item) => item.language))]
    .filter((language) => language !== parsed.data.sourceLanguage);
  const names: Record<RoomRole, string> = { host: "호스트", guest: "게스트" };
  for (const participant of context.room.participants) names[participant.role] = participant.name;
  const recent = log.events
    .filter((event): event is Extract<RoomEvent, { type: "utterance" }> => event.type === "utterance")
    .slice(-TRANSLATION_CONTEXT_LINES)
    .map((event) => ({ speaker: names[event.speaker], text: event.original }));
  // Fire-and-forget: the request already runs inside the host tenant context,
  // which AsyncLocalStorage propagates into these continuations.
  void translateInBackground(request, context.id, parsed.data.utteranceId, parsed.data.original, targets, recent);

  return jsonNoStore({
    accepted: true,
    seq: appended.seq,
    speaker: attribution.speaker,
    confidence: attribution.confidence,
    rule: attribution.rule,
    pendingTranslations: targets,
  });
}

async function translateInBackground(
  request: Request,
  roomId: string,
  utteranceId: string,
  original: string,
  targets: RoomLanguage[],
  context: TranslationContextLine[],
): Promise<void> {
  for (const language of targets) {
    try {
      const result = await translateText(original, language, { context });
      if (!result.ok) {
        safeLog("warn", { code: "room_translation_failed", operation: "room_translate", meetingId: roomId, phase: language, reason: result.reason });
        continue;
      }
      await appendRoomEvent(roomId, { type: "translation", utteranceId, language, text: result.translation });
      await recordRequestUsage(request, "translation");
    } catch (error) {
      if (error instanceof RoomStoreError && error.code === "room_ended") return;
      safeLog("warn", { code: "room_translation_failed", operation: "room_translate", meetingId: roomId, phase: language, reason: "exception" });
    }
  }
}
