import { z } from "zod";

import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPORARY_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key";
const requestSchema = z.object({
  service: z.enum(["stt", "tts"]).default("stt"),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  return jsonNoStore({ configured: Boolean(process.env.SONIOX_API_KEY?.trim()) });
}

export async function POST(request: Request): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  let body: unknown = {};
  if (request.headers.has("content-type")) {
    try {
      body = await parseBoundedJsonBody(request, 1024);
    } catch (error) {
      return requestBodyErrorResponse(error);
    }
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);
  const longLivedApiKey = process.env.SONIOX_API_KEY?.trim();
  if (!longLivedApiKey) return publicErrorResponse("local_service_unavailable", 503);

  try {
    const response = await fetch(TEMPORARY_KEY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${longLivedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usage_type: parsed.data.service === "tts" ? "tts_rt" : "transcribe_websocket",
        expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: parsed.data.service === "tts" ? 120 : 18_000,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return publicErrorResponse("local_service_unavailable", 502);
    const payload = await response.json() as { api_key?: unknown };
    if (typeof payload.api_key !== "string" || payload.api_key.length < 1) {
      return publicErrorResponse("local_service_unavailable", 502);
    }
    return jsonNoStore({ apiKey: payload.api_key });
  } catch {
    return publicErrorResponse("local_service_unavailable", 502);
  }
}
