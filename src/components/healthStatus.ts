import type { LlmProvider } from "@/services/llm/types";

export type StatusTone = "neutral" | "success" | "warn" | "error";

export interface StatusDisplay {
  label: string;
  shortLabel: string;
  title: string;
  tone: StatusTone;
  dotClass: string;
  textClass: string;
}

export interface WhisperHealthState {
  connected: boolean;
  ok?: boolean;
  ready?: boolean;
  model?: string | null;
  message?: string | null;
}

export type LlmHealthState =
  | { configured: false }
  | { configured: true; provider: LlmProvider | string; ok: boolean; detail: string; model?: string | null };

export type SonioxHealthState =
  | { kind: "checking" }
  | { kind: "configured" }
  | { kind: "unconfigured" }
  | { kind: "unknown" };

export type LlmReadiness = "loading" | "ready" | "unconfigured" | "unavailable";

const TONE_CLASS: Record<StatusTone, Pick<StatusDisplay, "dotClass" | "textClass">> = {
  neutral: { dotClass: "bg-inkSoft", textClass: "text-inkSoft" },
  success: { dotClass: "bg-success", textClass: "text-success" },
  warn: { dotClass: "bg-warn", textClass: "text-warn" },
  error: { dotClass: "bg-error", textClass: "text-error" },
};

function withTone(base: Omit<StatusDisplay, "dotClass" | "textClass">): StatusDisplay {
  return { ...base, ...TONE_CLASS[base.tone] };
}

function compact(parts: Array<string | null | undefined>): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(" ");
}

export function providerLabel(provider: string): string {
  switch (provider) {
    case "claude-cli":
      return "Claude CLI";
    case "codex-cli":
      return "외부 모델";
    case "ollama":
      return "Ollama";
    default:
      return provider;
  }
}

// The customer-facing rows never expose engine or model names ("Whisper
// large-v3" 등) — 로컬 전사는 이름 없이 준비 상태만 보여 준다.
export function formatWhisperStatus(health: WhisperHealthState | null): StatusDisplay {
  if (health === null) {
    return withTone({
      label: "로컬 전사 · 확인 중",
      shortLabel: "확인 중",
      title: "로컬 전사 서버 상태 확인 중",
      tone: "neutral",
    });
  }

  if (!health.connected) {
    return withTone({
      label: "로컬 전사 · 연결 안 됨",
      shortLabel: "연결 안 됨",
      title: health.message || "로컬 전사 서버에 연결할 수 없습니다.",
      tone: "error",
    });
  }

  const ready = health.ready === true || (health.ready === undefined && health.ok !== false);
  if (!ready) {
    return withTone({
      label: "로컬 전사 · 준비 중",
      shortLabel: "준비 중",
      title: health.message || "로컬 전사 준비 중",
      tone: "warn",
    });
  }

  return withTone({
    label: "로컬 전사 · 준비 완료",
    shortLabel: "준비 완료",
    title: "로컬 전사 사용 가능",
    tone: "success",
  });
}

export function getLlmReadiness(health: LlmHealthState | null): LlmReadiness {
  if (health === null) return "loading";
  if (!health.configured) return "unconfigured";
  return health.ok ? "ready" : "unavailable";
}

export function formatLlmStatus(health: LlmHealthState | null): StatusDisplay {
  if (health === null) {
    return withTone({
      label: "요약 모델 · 확인 중",
      shortLabel: "확인 중",
      title: "요약 모델 상태 확인 중",
      tone: "neutral",
    });
  }

  if (!health.configured) {
    return withTone({
      label: "요약 모델 미설정",
      shortLabel: "미설정",
      title: "요약 모델을 설정해야 회의록 요약을 생성할 수 있습니다.",
      tone: "warn",
    });
  }

  const provider = providerLabel(health.provider);
  const model = health.model?.trim() || null;
  const name = compact([provider, model]);

  if (!health.ok) {
    return withTone({
      label: `${name} · 실패`,
      shortLabel: "실패",
      title: health.detail,
      tone: "error",
    });
  }

  // CLI backends (codex/claude) do binary-only detection: `ok` means "detected",
  // not "authenticated". Show "감지됨" (optimistic) — real auth is confirmed on the
  // first summary. Non-CLI backends (ollama) keep the verified "연결됨" below.
  if (health.provider === "codex-cli" || health.provider === "claude-cli") {
    return withTone({
      label: `${name} · 감지됨`,
      shortLabel: "감지됨",
      title: `${name}가 감지되었습니다. 인증과 실제 요약 가능 여부는 첫 요약에서 확인됩니다.`,
      tone: "success",
    });
  }

  return withTone({
    label: `${name} · 연결됨`,
    shortLabel: "연결됨",
    title: health.detail,
    tone: "success",
  });
}

// 사이드바의 단일 "외부 모델" 행: 실시간 전사·번역 키와 요약 모델이 모두
// 준비됐을 때만 초록 "준비됨"을 보여 준다. 공급자 이름은 노출하지 않는다.
export function formatExternalStatus(
  llm: LlmHealthState | null,
  realtime: SonioxHealthState | null | undefined,
): StatusDisplay {
  if (llm === null || realtime == null || realtime.kind === "checking") {
    return withTone({
      label: "외부 모델 · 확인 중",
      shortLabel: "확인 중",
      title: "외부 모델 설정 여부를 확인하고 있습니다.",
      tone: "neutral",
    });
  }
  if (realtime.kind === "unknown") {
    return withTone({
      label: "외부 모델 · 확인 불가",
      shortLabel: "확인 불가",
      title: "로컬 설정 확인 요청에 실패해 외부 모델 설정 여부를 판단할 수 없습니다.",
      tone: "warn",
    });
  }
  if (realtime.kind === "unconfigured" || !llm.configured || !llm.ok) {
    return withTone({
      label: "외부 모델 · 준비 안됨",
      shortLabel: "준비 안됨",
      title: "설정에서 실시간 전사·번역 키와 요약 모델 설정을 완료해 주세요.",
      tone: "warn",
    });
  }
  return withTone({
    label: "외부 모델 · 준비됨",
    shortLabel: "준비됨",
    title: "실시간 전사·번역과 요약에 필요한 외부 모델 설정이 준비되었습니다.",
    tone: "success",
  });
}
