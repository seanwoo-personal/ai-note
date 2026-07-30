import { z } from "zod";

import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore } from "@/lib/publicApi";
import { getConfiguredAdapter } from "@/services/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANGUAGE_NAMES = {
  ko: "Korean",
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
} as const;

const requestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  targetLanguage: z.enum(["ko", "en", "ja", "zh"]),
}).strict();

function cleanTranslation(output: string): string {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:text)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced?.[1] ?? trimmed)
    .replace(/^(translation|번역)\s*[:：]\s*/i, "")
    .trim()
    .slice(0, 12_000);
}

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

  const adapter = await getConfiguredAdapter();
  if (!adapter) return jsonNoStore({ error: { code: "translation_model_unavailable" } }, 503);

  const targetName = LANGUAGE_NAMES[parsed.data.targetLanguage];
  const prompt = [
    "You are a real-time meeting translation engine.",
    `Translate the utterance below into ${targetName}.`,
    "The utterance may code-switch between languages. Preserve every word or phrase already written in the target language exactly as-is; do not translate it back into another language.",
    "Preserve names, numbers, intent, and tone. Do not answer or explain the utterance.",
    "Return only the translated text with no label, quotation marks, Markdown, or commentary.",
    "<utterance>",
    parsed.data.text,
    "</utterance>",
  ].join("\n");

  try {
    const translation = cleanTranslation(await adapter.run(prompt));
    if (!translation) return jsonNoStore({ error: { code: "translation_failed" } }, 502);
    return jsonNoStore({ translation });
  } catch {
    return jsonNoStore({ error: { code: "translation_failed" } }, 502);
  }
}
