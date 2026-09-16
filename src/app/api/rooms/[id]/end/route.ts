import { saveGlobalMeetingSession } from "@/lib/globalMeetingSave";
import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import { resolveRoomRequest, roomErrorResponse } from "@/lib/roomApi";
import { buildRoomDefaultTitle, buildRoomMinutes, buildRoomTranscript } from "@/lib/roomExport";
import { endRoom, readRoomEvents } from "@/lib/roomStore";

// POST /api/rooms/[id]/end — host only. Closes the room (starts the 24-hour
// guest window) and publishes transcript + minutes through the existing global
// meeting pair publisher so the room becomes an ordinary meeting of the host.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const context = await resolveRoomRequest(request, (await params).id, { requireHost: true });
  if (!context.ok) return context.response;

  let ended;
  try {
    ended = await endRoom(context.id);
  } catch (error) {
    return roomErrorResponse(error, context.id);
  }
  const endedAt = ended.endedAt!;
  const log = await readRoomEvents(context.id);
  if (log.corrupt) return publicErrorResponse("content_state_ambiguous", 409, { meetingId: context.id });

  const transcript = buildRoomTranscript(ended, log.events);
  const minutesBody = buildRoomMinutes(ended, log.events, endedAt);
  if (transcript.length === 0) {
    // Nothing was said: the room closes but no meeting artifact is published.
    return jsonNoStore({ ok: true, endedAt, guestExpiresAt: ended.guestExpiresAt, meeting: null });
  }
  const saved = await saveGlobalMeetingSession({
    id: context.id,
    startedAt: ended.createdAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(ended.createdAt)),
    transcript,
    minutesBody,
    title: ended.title ?? buildRoomDefaultTitle(ended, log.events, endedAt),
    participants: ended.participants.map((item) => item.name),
  });
  if (!saved.ok && saved.reason !== "already_saved") {
    return publicErrorResponse("content_save_unavailable", 503, { meetingId: context.id });
  }
  return jsonNoStore({
    ok: true,
    endedAt,
    guestExpiresAt: ended.guestExpiresAt,
    meeting: saved.ok ? saved.meeting : null,
    durability: saved.ok ? saved.durability : "durable",
  });
}
