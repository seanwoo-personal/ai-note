import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) throw new Error("usage: translate-customer-guide <input> <output>");

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("translation_key_missing");

function koreanCopy(html) {
  const source = html
    .replace(/<style[\s\S]*?<\/style>/gu, "")
    .replace(/<script[\s\S]*?<\/script>/gu, "")
    .replace(/data:image[^\x22]+/gu, "");
  const values = new Set();
  for (const match of source.matchAll(/>([^<>]+)</gu)) {
    const value = match[1].replace(/\s+/gu, " ").trim();
    if (/[가-힣]/u.test(value)) values.add(value);
  }
  for (const match of source.matchAll(/(?:alt|aria-label|title)="([^"]+)"/gu)) {
    const value = match[1].trim();
    if (/[가-힣]/u.test(value)) values.add(value);
  }
  return [...values].sort((left, right) => right.length - left.length || left.localeCompare(right, "ko"));
}

function parseJsonResponse(text) {
  const normalized = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  const parsed = JSON.parse(normalized);
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") throw new Error("translation_shape_invalid");
  for (const key of ["translations", "translation", "result", "output"]) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  throw new Error("translation_shape_invalid");
}

async function translateChunk(strings, locale) {
  const target = locale === "ja" ? "natural business Japanese" : "natural business English";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      models: ["google/gemini-2.5-flash-lite", "google/gemini-3.1-flash-lite"],
      messages: [{
        role: "user",
        content: [
          `Translate every Korean string in the JSON array into ${target} for a polished customer sales and user guide.`,
          "Return only one JSON object with a translations array in the exact same order and length.",
          "Do not summarize, omit, merge, annotate, or add Markdown. Preserve Vision, AI Meeting Agent, Zoom, Google Meet, Chrome, Android, JSON, Markdown, Push-to-Talk, PDF, CRM, and units as appropriate.",
          "Do not expose or add implementation provider names or internal technical architecture.",
          JSON.stringify(strings),
        ].join("\n"),
      }],
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "guide_translations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              translations: { type: "array", items: { type: "string" } },
            },
            required: ["translations"],
            additionalProperties: false,
          },
        },
      },
      provider: { sort: "price", zdr: true, data_collection: "deny" },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`translation_http_${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("translation_empty");
  const translated = parseJsonResponse(content);
  if (translated.length !== strings.length || translated.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("translation_count_mismatch");
  }
  return translated.map((value) => value.trim());
}

async function translateAll(strings, locale) {
  const result = {};
  const chunkSize = 32;
  for (let offset = 0; offset < strings.length; offset += chunkSize) {
    const chunk = strings.slice(offset, offset + chunkSize);
    let translated;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        translated = await translateChunk(chunk, locale);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!translated) throw lastError;
    chunk.forEach((source, index) => {
      result[source] = translated[index];
    });
  }
  return result;
}

const strings = koreanCopy(readFileSync(inputPath, "utf8"));
const translations = {
  en: await translateAll(strings, "en"),
  ja: await translateAll(strings, "ja"),
};
for (const locale of ["en", "ja"]) {
  if (Object.keys(translations[locale]).length !== strings.length) throw new Error("translation_incomplete");
  for (const translated of Object.values(translations[locale])) {
    if (/[가-힣]/u.test(translated)) throw new Error(`translation_contains_korean_${locale}`);
  }
}
writeFileSync(outputPath, `${JSON.stringify(translations, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ strings: strings.length, locales: Object.keys(translations) }));
