import { z } from "zod";

import { ROOM_ROLES } from "@/domain/room";
import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import { resolveRoomRequest, roomErrorResponse } from "@/lib/roomApi";
import { registerParticipantSpeakerLabel } from "@/lib/roomStore";

// POST /api/rooms/[id]/participants/[role]/speaker-label — same-room mode only.
// After a seat says one sentence, the host device binds the diarization label
// that sentence received to that seat (ADR 0028 §3, ladder step 3).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ speakerLabel: z.string().trim().min(1).max(16) }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; role: string }> },
): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const resolved = await params;
  const context = await resolveRoomRequest(request, resolved.id);
  if (!context.ok) return context.response;
  if (context.room.mode !== "same_room") return publicErrorResponse("invalid_request", 400, { field: "mode" });
  const role = ROOM_ROLES.find((item) => item === resolved.role);
  if (!role) return publicErrorResponse("invalid_request", 400, { field: "role" });
  // Only the device that holds the microphone (the host) can hear both seats.
  if (context.identity.role !== "host") return publicErrorResponse("resource_not_found", 404);

  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);
  try {
    const room = await registerParticipantSpeakerLabel(context.id, role, parsed.data.speakerLabel);
    return jsonNoStore({
      ok: true,
      participants: room.participants.map((item) => ({ role: item.role, name: item.name, language: item.language, registered: item.speakerLabel !== null })),
    });
  } catch (error) {
    return roomErrorResponse(error, context.id);
  }
}
