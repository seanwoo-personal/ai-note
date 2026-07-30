import { describe, expect, it } from "vitest";

import {
  formatExternalStatus,
  formatLlmStatus,
  formatWhisperStatus,
  getLlmReadiness,
  providerLabel,
} from "@/components/healthStatus";

describe("healthStatus", () => {
  it("formats local transcription readiness without exposing model names", () => {
    expect(formatWhisperStatus({ connected: true, ready: true, model: "base" })).toMatchObject({
      label: "로컬 전사 · 준비 완료",
      shortLabel: "준비 완료",
      tone: "success",
    });
    expect(formatWhisperStatus({ connected: true, ready: true, model: "large-v3" }).label)
      .not.toMatch(/whisper|large/i);
    expect(formatWhisperStatus({ connected: true, ready: false, model: "large-v3" })).toMatchObject({
      label: "로컬 전사 · 준비 중",
      tone: "warn",
    });
    expect(formatWhisperStatus({ connected: false, ready: false, model: null })).toMatchObject({
      label: "로컬 전사 · 연결 안 됨",
      tone: "error",
    });
  });

  it("formats llm provider/model labels and readiness", () => {
    expect(providerLabel("claude-cli")).toBe("Claude CLI");
    expect(providerLabel("ollama")).toBe("Ollama");

    expect(
      formatLlmStatus({ configured: true, provider: "claude-cli", model: "sonnet", ok: true, detail: "available" }),
    ).toMatchObject({
      label: "Claude CLI sonnet · 감지됨",
      title: expect.stringContaining("첫 요약"),
      tone: "success",
    });
    expect(formatLlmStatus({
      configured: true,
      provider: "ollama",
      model: "missing",
      ok: false,
      detail: "Ollama를 실행한 뒤 다시 검사하세요.",
    })).toMatchObject({
      label: "Ollama missing · 실패",
      title: "Ollama를 실행한 뒤 다시 검사하세요.",
      tone: "error",
    });
    expect(formatLlmStatus({ configured: false })).toMatchObject({
      label: "요약 모델 미설정",
      tone: "warn",
    });
  });

  it("only treats configured && ok as ready", () => {
    expect(getLlmReadiness(null)).toBe("loading");
    expect(getLlmReadiness({ configured: false })).toBe("unconfigured");
    expect(getLlmReadiness({ configured: true, provider: "ollama", ok: false, detail: "Ollama model not set" })).toBe(
      "unavailable",
    );
    expect(getLlmReadiness({ configured: true, provider: "claude-cli", ok: true, detail: "ready" })).toBe("ready");
  });

  it("shows a single external-model row that is green only when everything is configured", () => {
    const llmReady = { configured: true as const, provider: "claude-cli", ok: true, detail: "ready" };

    expect(formatExternalStatus(llmReady, { kind: "configured" })).toMatchObject({
      label: "외부 모델 · 준비됨",
      shortLabel: "준비됨",
      tone: "success",
    });
    expect(formatExternalStatus(llmReady, { kind: "unconfigured" })).toMatchObject({
      label: "외부 모델 · 준비 안됨",
      shortLabel: "준비 안됨",
      tone: "warn",
    });
    expect(formatExternalStatus({ configured: false }, { kind: "configured" })).toMatchObject({
      label: "외부 모델 · 준비 안됨",
      title: expect.stringContaining("요약 모델"),
      tone: "warn",
    });
    expect(formatExternalStatus(null, { kind: "checking" })).toMatchObject({
      label: "외부 모델 · 확인 중",
      tone: "neutral",
    });
    expect(formatExternalStatus(llmReady, { kind: "unknown" })).toMatchObject({
      label: "외부 모델 · 확인 불가",
      tone: "warn",
    });
    // No vendor names leak into the customer-facing status row.
    expect(formatExternalStatus(llmReady, { kind: "configured" }).label).not.toMatch(/soniox|codex/i);
    expect(formatExternalStatus(llmReady, { kind: "configured" }).title).not.toMatch(/soniox|codex/i);
  });
});
