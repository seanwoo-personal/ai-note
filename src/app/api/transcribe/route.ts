import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { isSafeId } from "@/lib/meetingId";
import { meetingFenceResponse } from "@/lib/meetingFence";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import { readStatus, updateStatus } from "@/lib/status";
import { enqueueTranscription } from "@/lib/transcribe";

// POST /api/transcribe { id } — manually enqueue/retry the cloud transcription.
// Provider failures map to a retryable error and never discard the recording.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  let body: { id?: unknown } | null;
  try {
    body = await parseBoundedJsonBody(request, 4 * 1024) as { id?: unknown } | null;
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const id = body?.id;
  if (!isSafeId(id)) {
    return publicErrorResponse("invalid_request", 400, { field: "meetingId" });
  }
  const fenced = await meetingFenceResponse(id);
  if (fenced) return fenced;

  try {
    const result = await enqueueTranscription(id);
    if (!result.ok) {
      const code = result.reason === "not_found" ? 404 : 409;
      return publicErrorResponse(
        result.reason === "not_found" ? "meeting_not_found" : "meeting_conflict",
        code,
        { meetingId: id },
      );
    }
    return jsonNoStore({
      id,
      status: result.state === "completed" ? "transcribed" : "transcribing",
      durability: result.durability,
    });
  } catch {
    const status = await readStatus(id);
    if (status) {
      await updateStatus(id, undefined, (latest) => ({
        ...latest,
        error: {
          code: "transcription_failed",
          message: "전사를 시작하지 못했습니다. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요",
          action: "retry_transcription",
        },
      }));
    }
    return publicErrorResponse("cloud_service_unavailable", 502);
  }
}
