import { z } from "zod";

import { ROOM_ROLES } from "@/domain/room";
import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import { resolveRoomRequest, roomErrorResponse } from "@/lib/roomApi";
import { appendRoomEvent, readRoomEvents } from "@/lib/roomStore";

// PATCH /api/rooms/[id]/utterances/[utteranceId]/speaker — manual correction
// of who said it. Only meaningful in a shared room, where attribution is inferred.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const speakerSchema = z.object({ speaker: z.enum(ROOM_ROLES) }).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; utteranceId: string }> },
): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const resolved = await params;
  const context = await resolveRoomRequest(request, resolved.id);
  if (!context.ok) return context.response;
  if (context.room.mode !== "same_room") return publicErrorResponse("invalid_request", 400, { field: "mode" });
  if (context.room.endedAt !== null) return publicErrorResponse("meeting_conflict", 409, { meetingId: context.id });
  const utteranceId = resolved.utteranceId;
  if (typeof utteranceId !== "string" || utteranceId.length < 1 || utteranceId.length > 64) {
    return publicErrorResponse("invalid_request", 400, { field: "utteranceId" });
  }

  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = speakerSchema.safeParse(body);
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);

  const log = await readRoomEvents(context.id);
  if (log.corrupt) return publicErrorResponse("content_state_ambiguous", 409, { meetingId: context.id });
  if (!log.events.some((event) => event.type === "utterance" && event.utteranceId === utteranceId)) {
    return publicErrorResponse("resource_not_found", 404);
  }
  try {
    const event = await appendRoomEvent(context.id, { type: "attribution", utteranceId, speaker: parsed.data.speaker });
    return jsonNoStore({ ok: true, seq: event.seq, speaker: parsed.data.speaker });
  } catch (error) {
    return roomErrorResponse(error, context.id);
  }
}
