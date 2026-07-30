import { tmpdir } from "node:os";

import { LLM_GENERATION_TIMEOUT_MS, runProcess } from "@/services/llm/exec";
import type { LlmAdapter, LlmHealth, LlmProvider, LlmSettings } from "@/services/llm/types";

// Codex backend — two modes, decided per call so a key added later wins without
// a restart:
//
// 1. API mode (customer machines): when CODEX_API_KEY/OPENAI_API_KEY is present
//    in the environment (.env.local, never stored in app data), run the prompt
//    through the provider's HTTPS completion API directly — no CLI install
//    needed. The key is read lazily inside the handler (build-green) and never
//    logged or echoed; errors surface as opaque codes.
// 2. CLI mode (fallback) — BEST-EFFORT. `codex exec` is an agentic runner (not a
//    plain completion API): it emits a JSONL event stream on stdout, from which
//    we salvage the model's final message. Auth is only verified on the first
//    real summary, so health() just confirms the binary exists. Run read-only in
//    a temp cwd, and skip the git-repo check so it works outside a repo.
//
// The `run` opts.json hint needs no extra flag here: the salvaged/API message is
// handed to the caller's tolerant extractor (chatOrchestrator/summarizeCore).
//
// UI copy must never surface the vendor name — settings/status call this the
// "외부 모델" backend.

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_API_MODEL = "gpt-5-mini";

function configuredApiKey(): string | null {
  return process.env.CODEX_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export class CodexCliAdapter implements LlmAdapter {
  readonly provider: LlmProvider = "codex-cli";

  constructor(private readonly settings: LlmSettings) {}

  async run(prompt: string): Promise<string> {
    const apiKey = configuredApiKey();
    if (apiKey) return this.runViaApi(prompt, apiKey);
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "-C",
      tmpdir(),
      ...(this.settings.model ? ["-m", this.settings.model] : []),
      "-",
    ];
    const { stdout } = await runProcess("codex", args, {
      stdin: prompt,
      timeoutMs: LLM_GENERATION_TIMEOUT_MS,
    });
    return extractFinalMessage(stdout);
  }

  private async runViaApi(prompt: string, apiKey: string): Promise<string> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.model?.trim() || DEFAULT_API_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(LLM_GENERATION_TIMEOUT_MS),
    });
    // Opaque failure codes only — never propagate provider response bodies.
    if (!response.ok) throw new Error(`summary_api_status_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new Error("summary_api_empty_response");
    return text;
  }

  async health(): Promise<LlmHealth> {
    if (configuredApiKey()) {
      return {
        ok: true,
        detail: "외부 요약 모델 API 키가 설정되었습니다. 실제 요약 가능 여부는 첫 요약에서 확인합니다.",
      };
    }
    try {
      await runProcess("codex", ["--version"], { timeoutMs: 15_000 });
      return {
        ok: true,
        detail: "외부 요약 CLI가 감지되었습니다. 인증과 실제 요약 가능 여부는 첫 요약에서 확인합니다.",
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException | undefined;
      if (e?.code === "ENOENT" || (e?.message?.includes("ENOENT") ?? false)) {
        return {
          ok: false,
          detail: "외부 요약 모델 API 키가 없고 CLI도 찾을 수 없습니다. API 키를 설정하거나 CLI를 설치하세요.",
        };
      }
      return {
        ok: false,
        detail: "외부 요약 모델 상태를 확인할 수 없습니다. API 키 또는 CLI 설치를 확인하세요.",
      };
    }
  }
}

// Tolerant JSONL parser: codex's event shape varies across versions, so we scan
// every line, skip anything unparseable, and keep the LAST non-empty text from
// events that look like the assistant's answer. If we salvage nothing, hand back
// the raw stdout — summarizeCore will still try to extract the JSON summary.
function extractFinalMessage(stdout: string): string {
  let last = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const text = pickText(obj);
    if (text) last = text;
  }
  return last ? last.trim() : stdout.trim();
}

// Pull answer text from the handful of shapes codex has used:
//   { msg: { type: "...agent_message...", message | text } }
//   { type: "...agent_message..." | "item.completed", item: { text | content } | text }
function pickText(obj: Record<string, unknown>): string {
  const msg = obj.msg as Record<string, unknown> | undefined;
  if (msg && typeof msg === "object") {
    const type = asString(msg.type);
    if (type.includes("agent_message") || type.includes("message")) {
      const t = asString(msg.message) || asString(msg.text);
      if (t) return t;
    }
  }

  const topType = asString(obj.type);
  if (topType.includes("agent_message") || topType.includes("item.completed")) {
    const item = obj.item as Record<string, unknown> | undefined;
    const t =
      (item && typeof item === "object"
        ? asString(item.text) || asString(item.content)
        : "") || asString(obj.text);
    if (t) return t;
  }

  return "";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
