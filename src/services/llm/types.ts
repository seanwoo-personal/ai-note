// LLM summarizer backends. API keys are read lazily from environment variables
// and are never persisted in the app data directory. Adapters produce raw text;
// src/lib/summarizeCore.ts parses and validates the structured result.

export type LlmProvider = "openrouter" | "claude-cli" | "codex-cli" | "ollama";

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  "openrouter",
  "claude-cli",
  "codex-cli",
  "ollama",
] as const;

export interface LlmSettings {
  provider: LlmProvider;
  /** Model id. Optional — each backend has a sensible default. */
  model?: string;
  /** Ollama base URL override (default http://127.0.0.1:11434). */
  baseUrl?: string;
}

export interface LlmHealth {
  ok: boolean;
  /** Human-readable status/reason, surfaced in the UI (e.g. "not logged in"). */
  detail: string;
}

export type LlmTask = "summary" | "chat" | "transcript" | "translation";

export interface LlmRunOptions {
  json?: boolean;
  /** Selects the cost/quality model chain without exposing routing in callers. */
  task?: LlmTask;
}

export interface LlmAdapter {
  provider: LlmProvider;
  /**
   * Run one prompt, return the model's text output. `json: true` hints the
   * backend to emit JSON where supported (summarizeCore tolerates prose/fences
   * regardless, so this is best-effort).
   */
  run(prompt: string, opts?: LlmRunOptions): Promise<string>;
  /** Cheap reachability/auth check for the settings "test connection" button. */
  health(): Promise<LlmHealth>;
}
