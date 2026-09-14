import { LLM_GENERATION_TIMEOUT_MS } from "@/services/llm/exec";
import type {
  LlmAdapter,
  LlmHealth,
  LlmProvider,
  LlmRunOptions,
  LlmSettings,
  LlmTask,
} from "@/services/llm/types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Transcript cleanup and translation favor the cheapest capable model. Summary
// and chat put the stronger structured-output model first. OpenRouter retries
// the remaining ids when the preferred model/provider is unavailable.
const BUDGET_MODELS = [
  "google/gemini-2.5-flash-lite",
  "mistralai/mistral-small-2603",
  "google/gemini-3.1-flash-lite",
] as const;
const QUALITY_MODELS = [
  "google/gemini-3.1-flash-lite",
  "google/gemini-2.5-flash-lite",
  "mistralai/mistral-small-2603",
] as const;

function apiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function modelChain(task: LlmTask | undefined, preferred: string | undefined): string[] {
  const defaults = task === "transcript" || task === "translation"
    ? BUDGET_MODELS
    : QUALITY_MODELS;
  return [...new Set([preferred?.trim(), ...defaults].filter((value): value is string => Boolean(value)))];
}

export class OpenRouterAdapter implements LlmAdapter {
  readonly provider: LlmProvider = "openrouter";

  constructor(private readonly settings: LlmSettings) {}

  async run(prompt: string, opts: LlmRunOptions = {}): Promise<string> {
    const key = apiKey();
    if (!key) throw new Error("openrouter_key_missing");

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        models: modelChain(opts.task, this.settings.model),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        provider: {
          sort: "price",
          zdr: true,
          data_collection: "deny",
        },
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(LLM_GENERATION_TIMEOUT_MS),
    });
    // Provider bodies can contain request details; only expose a stable code.
    if (!response.ok) throw new Error(`openrouter_status_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new Error("openrouter_empty_response");
    return text;
  }

  async health(): Promise<LlmHealth> {
    const key = apiKey();
    if (!key) {
      return {
        ok: false,
        detail: "서버 환경 변수 OPENROUTER_API_KEY를 설정하세요.",
      };
    }
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/key`, {
        headers: { authorization: `Bearer ${key}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { ok: false, detail: "OpenRouter API 키가 유효하지 않거나 연결할 수 없습니다." };
      }
      return { ok: true, detail: "OpenRouter 연결과 API 키를 확인했습니다." };
    } catch {
      return { ok: false, detail: "OpenRouter 연결을 확인할 수 없습니다." };
    }
  }
}

export const OPENROUTER_MODEL_CHAINS = {
  budget: BUDGET_MODELS,
  quality: QUALITY_MODELS,
} as const;
