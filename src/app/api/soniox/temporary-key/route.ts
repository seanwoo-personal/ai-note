import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPORARY_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key";

export async function GET(request: Request): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  return jsonNoStore({ configured: Boolean(process.env.SONIOX_API_KEY?.trim()) });
}

export async function POST(request: Request): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
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
        usage_type: "transcribe_websocket",
        expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: 18_000,
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
