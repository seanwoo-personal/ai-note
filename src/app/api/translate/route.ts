import { z } from "zod";

import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore } from "@/lib/publicApi";
import { recordRequestUsage } from "@/lib/accountUsage";
import { translateText } from "@/lib/translation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  targetLanguage: z.enum(["ko", "en", "ja", "zh"]),
}).strict();

export async function POST(request: Request) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 8 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return jsonNoStore({ error: { code: "invalid_request" } }, 400);

  const result = await translateText(parsed.data.text, parsed.data.targetLanguage);
  if (!result.ok) {
    return jsonNoStore({ error: { code: result.reason } }, result.reason === "translation_model_unavailable" ? 503 : 502);
  }
  await recordRequestUsage(request, "translation");
  return jsonNoStore({ translation: result.translation });
}
