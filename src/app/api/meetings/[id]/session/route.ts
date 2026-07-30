import { z } from "zod";

import {
  saveGlobalMeetingSession,
  type SaveGlobalMeetingSessionResult,
} from "@/lib/globalMeetingSave";
import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { assertSafeId } from "@/lib/meetingId";
import { meetingFenceResponse } from "@/lib/meetingFence";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

const sessionRequestSchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative().safe(),
  transcript: z.string().min(1).max(2 * 1024 * 1024),
  minutesBody: z.string().min(1).max(256 * 1024),
  title: z.string().max(200).optional(),
  participants: z.array(z.string().min(1).max(200)).max(64).optional(),
  workspaceId: uuidSchema.optional(),
  folderId: uuidSchema.nullable().optional(),
}).strict();

function failureResponse(
  result: Exclude<SaveGlobalMeetingSessionResult, { ok: true }>,
): Response {
  switch (result.reason) {
    case "invalid_transcript":
      return publicErrorResponse("invalid_request", 400, { field: "transcript" });
    case "invalid_minutes":
      return publicErrorResponse("invalid_request", 400, { field: "minutesBody" });
    case "already_saved":
    case "operation_in_progress":
      return publicErrorResponse("meeting_conflict", 409);
    default:
      return publicErrorResponse("content_save_unavailable", 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;

  let id: string;
  try {
    id = assertSafeId((await params).id);
  } catch {
    return publicErrorResponse("invalid_request", 400, { field: "meetingId" });
  }
  const fenced = await meetingFenceResponse(id);
  if (fenced) return fenced;

  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 4 * 1024 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = sessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return publicErrorResponse("invalid_request", 400, { field: "session" });
  }

  const { workspaceId, folderId, ...rest } = parsed.data;
  const result = await saveGlobalMeetingSession({
    id,
    ...rest,
    requestedLocation: workspaceId
      ? { workspaceId, folderId: folderId ?? null }
      : undefined,
  });

  return result.ok
    ? jsonNoStore({ ...result.meeting, durability: result.durability })
    : failureResponse(result);
}
