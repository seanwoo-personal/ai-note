import { describe, expect, it } from "vitest";

import {
  formatLlmStatus,
  formatRealtimeStatus,
  formatSummaryModelStatus,
  getLlmReadiness,
  providerLabel,
} from "@/components/healthStatus";

describe("healthStatus", () => {
  it("formats llm provider/model labels and readiness", () => {
    expect(providerLabel("openrouter")).toBe("OpenRouter");
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

  it("shows a customer-facing AI meeting-notes row separate from the realtime row", () => {
    expect(formatSummaryModelStatus(null)).toMatchObject({
      label: "AI 회의록 · 확인 중",
      shortLabel: "확인 중",
      tone: "neutral",
    });
    expect(formatSummaryModelStatus({ configured: false })).toMatchObject({
      label: "AI 회의록 · 준비 중",
      shortLabel: "준비 중",
      tone: "warn",
    });
    expect(
      formatSummaryModelStatus({ configured: true, provider: "claude-cli", ok: true, detail: "ready", model: "sonnet" }),
    ).toMatchObject({
      label: "AI 회의록 · 준비됨",
      shortLabel: "준비됨",
      tone: "success",
    });
    expect(
      formatSummaryModelStatus({ configured: true, provider: "ollama", ok: false, detail: "down", model: "x" }),
    ).toMatchObject({
      label: "AI 회의록 · 확인 필요",
      shortLabel: "확인 필요",
      tone: "error",
    });
    // The sidebar summary row never leaks the provider/model name (settings does that, not here).
    const ready = formatSummaryModelStatus({ configured: true, provider: "claude-cli", ok: true, detail: "ready", model: "sonnet" });
    expect(`${ready.label} ${ready.shortLabel} ${ready.title}`).not.toMatch(/soniox|codex|claude|ollama|sonnet/i);
  });

  it("derives the realtime row from live WebSocket connection truth, not config polling", () => {
    // Connection state is authoritative and overrides the capability signal.
    expect(formatRealtimeStatus("connected", { kind: "unconfigured" })).toMatchObject({
      label: "실시간 · 연결됨",
      shortLabel: "연결됨",
      tone: "success",
    });
    expect(formatRealtimeStatus("connecting", { kind: "configured" })).toMatchObject({
      label: "실시간 · 연결 중",
      shortLabel: "연결 중",
      tone: "neutral",
    });
    // When there is no live session, the config-presence capability distinguishes states.
    expect(formatRealtimeStatus("disconnected", null)).toMatchObject({
      label: "실시간 · 확인 중",
      tone: "neutral",
    });
    expect(formatRealtimeStatus("disconnected", { kind: "checking" })).toMatchObject({
      label: "실시간 · 확인 중",
      tone: "neutral",
    });
    expect(formatRealtimeStatus("disconnected", { kind: "unknown" })).toMatchObject({
      label: "실시간 · 확인 불가",
      shortLabel: "확인 불가",
      tone: "warn",
    });
    expect(formatRealtimeStatus("disconnected", { kind: "unconfigured" })).toMatchObject({
      label: "실시간 · 미설정",
      shortLabel: "미설정",
      tone: "warn",
    });
    expect(formatRealtimeStatus("disconnected", { kind: "configured" })).toMatchObject({
      label: "실시간 · 대기",
      shortLabel: "대기",
      tone: "neutral",
    });
    // No vendor name leaks into the realtime row.
    const connected = formatRealtimeStatus("connected", { kind: "configured" });
    expect(`${connected.label} ${connected.shortLabel} ${connected.title}`).not.toMatch(/soniox|soniworks/i);
  });
});
