import type { RoomLanguage } from "@/domain/room";
import { getConfiguredAdapter } from "@/services/llm";

// Single translation primitive shared by /api/translate and the interpreter
// room pipeline. It reuses the configured LLM adapter (task "translation"
// selects the budget chain) and never exposes provider output.

export const TRANSLATION_LANGUAGE_NAMES: Record<RoomLanguage, string> = {
  ko: "Korean",
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
};

export type TranslateTextResult =
  | { ok: true; translation: string }
  | { ok: false; reason: "translation_model_unavailable" | "translation_failed" };

export function cleanTranslation(output: string): string {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:text)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced?.[1] ?? trimmed)
    .replace(/^(translation|번역)\s*[:：]\s*/i, "")
    .trim()
    .slice(0, 12_000);
}

export interface TranslationContextLine {
  speaker: string;
  text: string;
}

export interface TranslationPromptOptions {
  /** Preceding utterances, oldest first. Read-only background for fragments and references. */
  context?: TranslationContextLine[];
}

export const TRANSLATION_CONTEXT_LINES = 4;

export function buildTranslationPrompt(text: string, targetLanguage: RoomLanguage, options: TranslationPromptOptions = {}): string {
  const targetName = TRANSLATION_LANGUAGE_NAMES[targetLanguage];
  const context = (options.context ?? []).filter((line) => line.text.trim()).slice(-TRANSLATION_CONTEXT_LINES);
  const lines = [
    "You are a real-time meeting translation engine.",
    `Translate the utterance below into ${targetName}.`,
    "The utterance may code-switch between languages. Preserve every word or phrase already written in the target language exactly as-is; do not translate it back into another language.",
    "The speaker may use regional dialect or casual spoken forms; translate the intended meaning into natural standard speech of the target language.",
    "Preserve names, numbers, intent, and tone. Do not answer or explain the utterance.",
  ];
  if (context.length > 0) {
    lines.push(
      "The <context> block holds what was said just before, oldest first. Use it only to resolve references and to read the utterance as a continuation when it is a fragment of an unfinished sentence, so the translation continues naturally.",
      "Translate only the utterance inside <utterance>; never repeat or translate the context.",
      "<context>",
      ...context.map((line) => `${line.speaker}: ${line.text}`),
      "</context>",
    );
  }
  lines.push(
    "Return only the translated text with no label, quotation marks, Markdown, or commentary.",
    "<utterance>",
    text,
    "</utterance>",
  );
  return lines.join("\n");
}

export const TRANSLATION_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("translation_timeout")), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function translateText(
  text: string,
  targetLanguage: RoomLanguage,
  options: { timeoutMs?: number } & TranslationPromptOptions = {},
): Promise<TranslateTextResult> {
  const adapter = await getConfiguredAdapter();
  if (!adapter) return { ok: false, reason: "translation_model_unavailable" };
  try {
    const translation = cleanTranslation(await withTimeout(
      adapter.run(buildTranslationPrompt(text, targetLanguage, { context: options.context }), { task: "translation" }),
      options.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
    ));
    if (!translation) return { ok: false, reason: "translation_failed" };
    return { ok: true, translation };
  } catch {
    return { ok: false, reason: "translation_failed" };
  }
}
