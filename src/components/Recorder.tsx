"use client";

import { useEffect, useState } from "react";

import { useRecorder } from "@/components/useRecorder";
import type { RecorderRequestedLocation } from "@/components/RecorderSessionProvider";
import { RecorderFinalizeResultView } from "@/components/RecorderFinalizeResultView";
import { formatDuration, recorderPhaseAnnouncement } from "@/lib/recorder";
import type { SonioxTranslationOptions } from "@/services/sonioxRealtime";

// Human labels for the server-derived lifecycle polled after upload.
const STATUS_LABELS: Record<string, string> = {
  recorded: "저장됨 · 전사 대기",
  transcribing: "전사 중…",
  transcribed: "전사 완료",
  summarizing: "요약 생성 중…",
  summarized: "요약 완료",
};

const LIVE_STATUS_LABELS = {
  connecting: "Soniox 연결 중…",
  connected: "Soniox 실시간 전사 중",
  finishing: "Soniox 전사 마무리 중…",
  finished: "Soniox 실시간 전사 완료",
  error: "Soniox 실시간 전사 오류",
} as const;

function liveTranslation(value: string): SonioxTranslationOptions {
  if (value === "none") return { mode: "none" };
  if (value === "two_way:ko-en") {
    return { mode: "two_way", languageA: "ko", languageB: "en" };
  }
  return { mode: "one_way", targetLanguage: value.split(":")[1] || "en" };
}

export function Recorder({
  requestedLocation,
}: {
  requestedLocation?: RecorderRequestedLocation;
} = {}) {
  const {
    phase,
    elapsedMs,
    level,
    error,
    serverStatus,
    finalizeResult,
    meetingId,
    hasRetainedBlob,
    retryDisposition,
    liveStatus,
    liveTranscript,
    liveError,
    start,
    stop,
    retry,
    probe,
  } = useRecorder();
  const [sonioxConfigured, setSonioxConfigured] = useState(false);
  const [transcriptionMode, setTranscriptionMode] = useState<"whisper" | "soniox">("whisper");
  const [translationValue, setTranslationValue] = useState("one_way:en");

  useEffect(() => {
    let active = true;
    void fetch("/api/soniox/temporary-key", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ configured?: unknown }> : null)
      .then((payload) => {
        if (active) setSonioxConfigured(payload?.configured === true);
      })
      .catch(() => {
        if (active) setSonioxConfigured(false);
      });
    return () => { active = false; };
  }, []);

  const beginRecording = () => void start({
    requestedLocation,
    ...(transcriptionMode === "soniox" && sonioxConfigured
      ? { soniox: { translation: liveTranslation(translationValue) } }
      : {}),
  });

  const recording = phase === "recording";
  const busy = phase === "requesting_permission" || phase === "stopping" || phase === "uploading";
  const retryable = phase === "captured" || phase === "finalize_ambiguous" || (
    phase === "failed" && hasRetainedBlob && retryDisposition === "body_required"
  );
  const blocked = phase === "failed" && hasRetainedBlob && retryDisposition === "blocked";
  // Speech RMS rarely exceeds ~0.3, so scale up for a readable meter fill.
  const meterPct = Math.min(100, Math.round(level * 300));
  const statusLabel = serverStatus
    ? (STATUS_LABELS[serverStatus.status] ?? serverStatus.status)
    : null;
  const idleStartLabel = transcriptionMode === "soniox"
    ? "Soniox 실시간 전사로 녹음 시작"
    : "Whisper 전사용 녹음 시작";

  return (
    <section
      id="recorder"
      className="w-full min-w-0 rounded-[16px] border border-line bg-panel p-4 shadow-[0_1px_2px_rgba(42,36,32,.04),0_8px_28px_-12px_rgba(42,36,32,.18)] sm:p-6"
    >
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold text-ink">새 회의 녹음</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-inkSoft">
            전사 방식을 고른 뒤 녹음을 시작하세요. 어떤 방식을 선택해도 원본 오디오는 이 Mac에 저장됩니다.
          </p>
        </div>
        <button
          id="meeting-recorder-start"
          type="button"
          onClick={recording
            ? stop
            : phase === "finalize_ambiguous"
              ? () => void probe()
              : retryable
                ? () => void retry()
                : beginRecording}
          disabled={busy || blocked}
          className="min-h-11 w-full shrink-0 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 sm:w-auto"
        >
          {recording
            ? "기록 중지"
            : phase === "requesting_permission"
              ? "권한 확인 중…"
              : phase === "stopping" || phase === "captured"
                ? "녹음 정리 중…"
                : phase === "uploading"
                  ? "저장 중…"
                  : retryable
                    ? phase === "finalize_ambiguous" ? "저장 상태 확인" : "저장 다시 시도"
                    : blocked
                      ? "저장 상태 충돌"
                      : idleStartLabel}
        </button>
      </div>

      {(phase === "idle" || phase === "saved") && (
        <div className="mt-5 space-y-3">
          <fieldset role="radiogroup" aria-labelledby="transcription-mode-label">
            <legend id="transcription-mode-label" className="mb-2 text-[13px] font-semibold text-ink">
              전사 방식
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${
                transcriptionMode === "whisper"
                  ? "border-accent bg-accent/5"
                  : "border-line bg-soft/30 hover:bg-soft/60"
              }`}>
                <input
                  type="radio"
                  name="transcription-mode"
                  value="whisper"
                  checked={transcriptionMode === "whisper"}
                  onChange={() => setTranscriptionMode("whisper")}
                  className="mt-1 h-4 w-4 shrink-0 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink">로컬 전사 (Whisper)</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-inkSoft">
                    녹음을 마친 뒤 이 Mac에서 전사합니다. 오디오를 외부 전사 서비스로 보내지 않습니다. 처음 쓰는 모델은 준비에 시간이 걸릴 수 있습니다.
                  </span>
                </span>
              </label>
              <label className={`flex gap-3 rounded-xl border p-4 transition-colors ${
                transcriptionMode === "soniox"
                  ? "border-accent bg-accent/5"
                  : "border-line bg-soft/30"
              } ${sonioxConfigured ? "cursor-pointer hover:bg-soft/60" : "cursor-not-allowed opacity-60"}`}>
                <input
                  type="radio"
                  name="transcription-mode"
                  value="soniox"
                  checked={transcriptionMode === "soniox"}
                  disabled={!sonioxConfigured}
                  onChange={() => setTranscriptionMode("soniox")}
                  className="mt-1 h-4 w-4 shrink-0 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink">실시간 전사 (Soniox)</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-inkSoft">
                    녹음 중 원문을 바로 보고, 필요한 경우 번역도 함께 표시합니다.
                  </span>
                  {!sonioxConfigured && (
                    <span className="mt-1 block text-[12px] font-medium text-error">
                      SONIOX_API_KEY를 설정해야 사용할 수 있습니다.
                    </span>
                  )}
                </span>
              </label>
            </div>
          </fieldset>

          {transcriptionMode === "soniox" && sonioxConfigured && (
            <div className="rounded-xl border border-line bg-soft/40 p-4">
              <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink sm:flex-row sm:items-center sm:justify-between">
                <span>번역 방식</span>
                <select
                  aria-label="번역 방식"
                  value={translationValue}
                  onChange={(event) => setTranslationValue(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-ink sm:w-auto"
                >
                  <option value="none">번역하지 않음 (원문만)</option>
                  <option value="one_way:en">영어 번역 함께 보기</option>
                  <option value="one_way:ko">한국어 번역 함께 보기</option>
                  <option value="one_way:ja">일본어 번역 함께 보기</option>
                  <option value="one_way:zh">중국어 번역 함께 보기</option>
                  <option value="two_way:ko-en">한국어·영어 대화 양방향 번역</option>
                </select>
              </label>
              <p className="mt-3 text-[12px] leading-relaxed text-inkSoft">
                녹음하는 동안 마이크 오디오를 Soniox 서버로 전송합니다. Soniox 사용량에 따라 비용이 발생할 수 있습니다.
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-inkSoft">
                원본 녹음은 로컬에 저장합니다. 종료 후에는 로컬 Whisper가 최종 스크립트를 만들어 회의 파일에 저장합니다.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Phase transitions are announced once here; the ticking timer and the rapidly
          changing meter below are deliberately kept out of any live region. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="recorder-announce">
        {recorderPhaseAnnouncement(phase)}
      </p>

      <div className="mt-5">
        {recording && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <span
                className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-error motion-reduce:animate-none"
                aria-hidden="true"
              />
              {transcriptionMode === "soniox"
                ? "녹음 중 · Soniox 실시간 전사"
                : "녹음 중 · 종료 후 Whisper 전사"}
            </span>
            <span className="font-mono text-[15px] tabular-nums text-ink">
              {formatDuration(elapsedMs)}
            </span>
            <div
              className="ml-1 h-2 flex-1 overflow-hidden rounded-full bg-soft"
              role="meter"
              aria-label="입력 레벨"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meterPct}
            >
              <div
                className="h-full rounded-full bg-success transition-[width] duration-75"
                style={{ width: `${meterPct}%` }}
              />
            </div>
          </div>
        )}

        {liveStatus !== "idle" && (
          <div className="mt-4 grid gap-3 rounded-xl border border-line bg-soft/30 p-4 md:grid-cols-2">
            <p role="status" className="text-[12px] font-semibold text-accent md:col-span-2">
              {LIVE_STATUS_LABELS[liveStatus]}
            </p>
            <div>
              <div className="text-[12px] font-semibold text-inkSoft">Soniox 실시간 원문</div>
              <p className="mt-2 min-h-12 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                {liveTranscript.original.final}
                <span className="text-inkSoft">{liveTranscript.original.provisional}</span>
              </p>
            </div>
            {(liveTranscript.translation.final || liveTranscript.translation.provisional) && (
              <div>
                <div className="text-[12px] font-semibold text-inkSoft">Soniox 실시간 번역</div>
                <p className="mt-2 min-h-12 whitespace-pre-wrap text-[15px] leading-relaxed text-accent">
                  {liveTranscript.translation.final}
                  <span className="text-inkSoft">{liveTranscript.translation.provisional}</span>
                </p>
              </div>
            )}
            {liveError && <p className="text-[13px] text-error md:col-span-2">{liveError}</p>}
          </div>
        )}

        {(phase === "idle" || phase === "saved") && (
          <p className="text-[13px] text-inkSoft">
            {phase === "saved"
              ? `저장 완료${statusLabel ? ` · ${statusLabel}` : ""}`
              : transcriptionMode === "soniox"
                ? translationValue === "none"
                  ? "Soniox에서 실시간 원문을 보려면 녹음을 시작하세요. 마이크 권한이 필요합니다."
                  : "Soniox에서 실시간 원문과 번역을 보려면 녹음을 시작하세요. 마이크 권한이 필요합니다."
                : "녹음이 끝나면 이 Mac에서 Whisper 전사를 시작합니다. 마이크 권한이 필요합니다."}
          </p>
        )}

        {(phase === "requesting_permission"
          || phase === "stopping"
          || phase === "captured"
          || phase === "uploading") && (
          <p className="text-[14px] text-inkSoft">
            {phase === "requesting_permission"
              ? "마이크 권한을 확인하는 중…"
              : phase === "uploading"
                ? "녹음을 저장하는 중…"
                : "녹음을 안전하게 정리하는 중…"}
          </p>
        )}

        {(phase === "failed" || phase === "finalize_ambiguous") && error && (
          <p role="status" className="text-[14px] text-error">{error}</p>
        )}
        {blocked && (
          <div className="mt-3 space-y-3 rounded-[12px] border border-warn/40 bg-warnBg px-4 py-3">
            <p className="text-[13px] leading-relaxed text-ink">
              서버 상태가 충돌하거나 삭제 경계가 모호해 원본을 덮어쓰지 않습니다. 데이터 폴더를 확인한 뒤 보존한 녹음을 유지하거나 명시적으로 버리세요.
            </p>
            <button
              type="button"
              onClick={() => {
                void fetch("/api/library/reveal", { method: "POST" }).catch(() => {});
              }}
              className="min-h-11 rounded-full border border-line px-4 text-[13px] font-semibold text-accent"
            >
              데이터 폴더 열기
            </button>
          </div>
        )}
        {phase === "saved" && finalizeResult && meetingId && (
          <RecorderFinalizeResultView
            meetingId={meetingId}
            result={finalizeResult}
            onRefresh={() => probe()}
          />
        )}
      </div>
    </section>
  );
}
