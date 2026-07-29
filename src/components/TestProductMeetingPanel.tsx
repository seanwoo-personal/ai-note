"use client";

import { useEffect, useRef, useState } from "react";

import { type useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";
import { type useSonioxTts } from "@/components/useSonioxTts";

const LANGUAGES = [
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
] as const;

type Capture = ReturnType<typeof useSonioxLiveCapture>;
type Speech = ReturnType<typeof useSonioxTts>;

type MeetingEntry = {
  id: number;
  speaker: string;
  original: string;
  sourceLanguage: string;
  korean: string;
  direction: "incoming" | "outbound";
};

type TranslationJob = {
  id: number;
  text: string;
  targetLanguage: string;
  kind: "incoming" | "outbound";
};

type PushToTalkPhase = "idle" | "recording" | "finalizing" | "translating" | "speaking" | "sent";

type FrozenPushToTalk = {
  text: string;
  targetLanguage: string;
  closingEndpointCount: number;
};

function speakerLabel(speaker: string | null): string {
  return speaker ? `화자 ${speaker}` : "화자 미확인";
}

function hasUtteranceAwaitingEndpoint(transcript: Capture["transcript"]): boolean {
  if (transcript.original.provisional.trim()) return true;
  const speaker = transcript.activeSpeaker;
  if (!speaker) return false;
  const track = transcript.speakers[speaker];
  if (!track) return false;
  const endpoint = [...(transcript.endpoints ?? [])].reverse().find((item) => item.speaker === speaker);
  return endpoint ? track.original.final !== endpoint.originalFinal : Boolean(track.original.final.trim());
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, a, [role='button'], [role='link'], [contenteditable='true']"));
}

export function TestProductMeetingPanel({ capture, speech }: { capture: Capture; speech: Speech }) {
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [entries, setEntries] = useState<MeetingEntry[]>([]);
  const [translationQueue, setTranslationQueue] = useState<TranslationJob[]>([]);
  const [speechQueue, setSpeechQueue] = useState<Array<{ id: number; text: string; language: string }>>([]);
  const [pushToTalkPhase, setPushToTalkPhase] = useState<PushToTalkPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastEndpointRef = useRef(0);
  const originalLengthsRef = useRef<Record<string, number>>({});
  const processingRef = useRef(false);
  const speechProcessingRef = useRef(false);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const captureStopRef = useRef(capture.stop);
  const speechStopRef = useRef(speech.stop);
  const pushToTalkEndpointRef = useRef(0);
  const pushToTalkLengthsRef = useRef<Record<string, number>>({});
  const frozenPushToTalkRef = useRef<FrozenPushToTalk | null>(null);
  const userSpeakerRef = useRef<string | null>(null);
  const outboundIdRef = useRef(1_000_000);
  captureStopRef.current = capture.stop;
  speechStopRef.current = speech.stop;
  const active = ["requesting", "connecting", "listening", "finishing"].includes(capture.phase);

  useEffect(() => {
    if (capture.transcript.endpointCount <= lastEndpointRef.current) return;
    const endpoints = (capture.transcript.endpoints ?? []).filter((endpoint) => endpoint.id > lastEndpointRef.current);
    lastEndpointRef.current = capture.transcript.endpointCount;
    const nextEntries: MeetingEntry[] = [];
    const nextJobs: TranslationJob[] = [];
    for (const endpoint of endpoints) {
      const speakerKey = endpoint.speaker ?? "unknown";
      const previousLength = originalLengthsRef.current[speakerKey] ?? 0;
      const original = endpoint.originalFinal.slice(previousLength).trim();
      originalLengthsRef.current[speakerKey] = endpoint.originalFinal.length;
      if (!original) continue;
      const sourceLanguage = endpoint.originalLanguage ?? "unknown";
      const korean = sourceLanguage.startsWith("ko") ? original : "";
      nextEntries.push({ id: endpoint.id, speaker: speakerLabel(endpoint.speaker), original, sourceLanguage, korean, direction: "incoming" });
      if (!korean) nextJobs.push({ id: endpoint.id, text: original, targetLanguage: "ko", kind: "incoming" });
    }
    if (nextEntries.length) setEntries((current) => [...current, ...nextEntries]);
    if (nextJobs.length) setTranslationQueue((current) => [...current, ...nextJobs]);
  }, [capture.transcript.endpointCount, capture.transcript.endpoints]);

  useEffect(() => {
    if (processingRef.current || translationQueue.length === 0) return;
    const job = translationQueue[0];
    const generation = generationRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20_000);
    processingRef.current = true;
    abortRef.current = controller;
    void fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: job.text, targetLanguage: job.targetLanguage }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { translation?: unknown };
      if (!response.ok || typeof payload.translation !== "string" || !payload.translation.trim()) throw new Error("translation_failed");
      if (generationRef.current !== generation) return;
      const translated = payload.translation.trim();
      setEntries((current) => current.map((entry) => entry.id === job.id
        ? job.kind === "incoming" ? { ...entry, korean: translated } : { ...entry, original: translated }
        : entry));
      if (job.kind === "outbound") {
        setSpeechQueue((current) => [...current, { id: job.id, text: translated, language: job.targetLanguage }]);
        setPushToTalkPhase("speaking");
      }
    }).catch((reason: unknown) => {
      if (((reason as { name?: string }).name !== "AbortError" || timedOut) && generationRef.current === generation) {
        setError(job.kind === "outbound"
          ? "내 발화를 상대방 언어로 번역하지 못했습니다. 다시 시도해 주세요."
          : "한국어 번역에 실패했습니다. 다음 발언은 계속 처리합니다.");
        if (job.kind === "outbound") setPushToTalkPhase("idle");
      }
    }).finally(() => {
      window.clearTimeout(timeout);
      if (generationRef.current === generation) {
        setTranslationQueue((current) => current[0]?.id === job.id ? current.slice(1) : current.filter((item) => item.id !== job.id));
      }
      if (abortRef.current === controller) abortRef.current = null;
      processingRef.current = false;
    });
  }, [translationQueue]);

  useEffect(() => {
    if (speechProcessingRef.current || speechQueue.length === 0 || !["idle", "finished", "error"].includes(speech.phase)) return;
    const item = speechQueue[0];
    const generation = generationRef.current;
    speechProcessingRef.current = true;
    void speech.speak({ text: item.text, language: item.language, voice: "Maya", speed: 1 }).catch(() => {
      if (generationRef.current === generation) setError("번역문은 표시했지만 음성 송출을 재생하지 못했습니다.");
    }).finally(() => {
      if (generationRef.current === generation) {
        setSpeechQueue((current) => current[0]?.id === item.id ? current.slice(1) : current.filter((queued) => queued.id !== item.id));
      }
      speechProcessingRef.current = false;
    });
  }, [speech, speech.phase, speechQueue]);

  useEffect(() => {
    if (pushToTalkPhase === "speaking" && speech.phase === "finished" && speechQueue.length === 0 && !speechProcessingRef.current) {
      setPushToTalkPhase("sent");
    } else if (pushToTalkPhase === "speaking" && speech.phase === "error") {
      setPushToTalkPhase("idle");
    }
  }, [pushToTalkPhase, speech.phase, speechQueue.length]);

  const freezePushToTalk = (): FrozenPushToTalk => {
    const inferredSpeaker = userSpeakerRef.current ?? capture.transcript.activeSpeaker ?? capture.transcript.lastEndpointSpeaker;
    if (inferredSpeaker) userSpeakerRef.current = inferredSpeaker;
    const endpointSpeaker = inferredSpeaker ?? "unknown";
    const endpoints = (capture.transcript.endpoints ?? []).filter((endpoint) =>
      endpoint.id > pushToTalkEndpointRef.current && (endpoint.speaker ?? "unknown") === endpointSpeaker);
    const lengths = { ...pushToTalkLengthsRef.current };
    const parts: string[] = [];
    for (const endpoint of endpoints) {
      const speakerKey = endpoint.speaker ?? "unknown";
      const previousLength = lengths[speakerKey] ?? 0;
      const text = endpoint.originalFinal.slice(previousLength).trim();
      lengths[speakerKey] = endpoint.originalFinal.length;
      if (text) parts.push(text);
    }
    const activeSpeaker = capture.transcript.activeSpeaker;
    if (activeSpeaker && activeSpeaker === inferredSpeaker) {
      const track = capture.transcript.speakers[activeSpeaker];
      const current = track ? `${track.original.final}${track.original.provisional}` : "";
      const pending = current.slice(lengths[activeSpeaker] ?? 0).trim();
      if (pending) parts.push(pending);
    } else if (!inferredSpeaker) {
      const current = `${capture.transcript.original.final}${capture.transcript.original.provisional}`;
      const pending = current.slice(lengths.unknown ?? 0).trim();
      if (pending) parts.push(pending);
    }
    return {
      text: parts.join(" ").trim(),
      targetLanguage,
      closingEndpointCount: capture.transcript.endpointCount,
    };
  };

  const enqueuePushToTalk = (frozen: FrozenPushToTalk) => {
    frozenPushToTalkRef.current = null;
    const { text, targetLanguage: frozenTargetLanguage } = frozen;
    if (!text) {
      setError("스페이스바 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
      setPushToTalkPhase("idle");
      return;
    }
    const id = outboundIdRef.current;
    outboundIdRef.current += 1;
    setEntries((current) => [...current, {
      id,
      speaker: "나 · Push-to-Talk",
      original: "",
      sourceLanguage: frozenTargetLanguage,
      korean: text,
      direction: "outbound",
    }]);
    setTranslationQueue((current) => [...current, { id, text, targetLanguage: frozenTargetLanguage, kind: "outbound" }]);
    setPushToTalkPhase("translating");
    setError(null);
  };

  const togglePushToTalk = () => {
    if (capture.phase !== "listening" || ["finalizing", "translating", "speaking"].includes(pushToTalkPhase) || ["connecting", "playing"].includes(speech.phase)) return;
    if (pushToTalkPhase !== "recording") {
      pushToTalkEndpointRef.current = capture.transcript.endpointCount;
      pushToTalkLengthsRef.current = Object.fromEntries(
        Object.entries(capture.transcript.speakers).map(([speaker, track]) => [speaker, `${track.original.final}${track.original.provisional}`.length]),
      );
      pushToTalkLengthsRef.current.unknown = `${capture.transcript.original.final}${capture.transcript.original.provisional}`.length;
      setPushToTalkPhase("recording");
      setError(null);
      void speech.prepare();
      return;
    }
    const frozen = freezePushToTalk();
    frozenPushToTalkRef.current = frozen;
    if (!hasUtteranceAwaitingEndpoint(capture.transcript)) {
      enqueuePushToTalk(frozen);
    } else {
      setPushToTalkPhase("finalizing");
    }
  };

  useEffect(() => {
    const frozen = frozenPushToTalkRef.current;
    if (pushToTalkPhase !== "finalizing" || !frozen || capture.transcript.endpointCount <= frozen.closingEndpointCount) return;
    enqueuePushToTalk(frozen);
  }, [capture.transcript, pushToTalkPhase]);

  useEffect(() => {
    if (pushToTalkPhase !== "finalizing") return;
    const generation = generationRef.current;
    const timer = window.setTimeout(() => {
      if (generationRef.current !== generation) return;
      frozenPushToTalkRef.current = null;
      setPushToTalkPhase("idle");
      setError("스페이스바 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pushToTalkPhase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTextInputTarget(event.target)) return;
      if (capture.phase !== "listening") return;
      event.preventDefault();
      togglePushToTalk();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    captureStopRef.current();
    speechStopRef.current();
  }, []);

  const startMeeting = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    processingRef.current = false;
    lastEndpointRef.current = 0;
    originalLengthsRef.current = {};
    frozenPushToTalkRef.current = null;
    userSpeakerRef.current = null;
    setEntries([]);
    setTranslationQueue([]);
    setSpeechQueue([]);
    setPushToTalkPhase("idle");
    setError(null);
    speech.stop();
    capture.reset();
    void capture.start({ inputSource: "microphone", translation: { mode: "none" } });
  };

  const stopMeeting = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    processingRef.current = false;
    capture.stop();
    speech.stop();
    frozenPushToTalkRef.current = null;
    userSpeakerRef.current = null;
    setTranslationQueue([]);
    setSpeechQueue([]);
    setPushToTalkPhase("idle");
  };

  const pushToTalkLabel = {
    idle: "스페이스바를 눌러 내 발화를 시작하세요.",
    recording: "내 발화 수집 중 · 말을 마치면 스페이스바를 다시 누르세요.",
    finalizing: "마지막 문장 확정 중…",
    translating: "상대방 언어로 번역 중…",
    speaking: "번역 음성 송출 중…",
    sent: "송출 완료 · 스페이스바를 눌러 다시 말할 수 있습니다.",
  }[pushToTalkPhase];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[20px] font-bold text-ink">자유 참여 글로벌 미팅</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">참석자 등록 없이 Soniox가 세션 화자를 자동 구분하고, 모든 외국어 발언을 한국어로 정리합니다.</p>
          </div>
          <label className="flex min-w-48 flex-col gap-2 text-[13px] font-semibold text-ink">
            <span>내 송출 대상 언어</span>
            <select aria-label="내 송출 대상 언어" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink">
              {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={active ? stopMeeting : startMeeting} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg">
            {active ? "미팅 중지" : "미팅 시작"}
          </button>
          <button type="button" disabled={capture.phase !== "listening" || ["finalizing", "translating", "speaking"].includes(pushToTalkPhase) || ["connecting", "playing"].includes(speech.phase)} onClick={togglePushToTalk} className={`min-h-11 rounded-full border px-5 text-[14px] font-semibold disabled:opacity-40 ${pushToTalkPhase === "recording" ? "border-error bg-error/10 text-error" : "border-line text-accent"}`}>
            {pushToTalkPhase === "recording" ? "내 발화 종료" : "내 발화 시작"}
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-soft/40 p-4">
          <p className="text-[12px] font-bold text-ink">Push-to-Talk · Space</p>
          <p role="status" aria-label="Push-to-Talk 상태" className="mt-1 text-[13px] leading-6 text-inkSoft">{pushToTalkLabel}</p>
          <p className="mt-1 text-[12px] leading-5 text-inkSoft">첫 Push-to-Talk 구간에서 감지된 활성 화자를 이 세션의 내 화자로 자동 고정합니다. 첫 구간에서는 다른 참석자가 동시에 말하지 않도록 해 주세요.</p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="한국어 회의 내용" className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-[16px] font-bold text-ink">한국어</h3>
          <div role="log" aria-label="한국어 실시간 기록" aria-live="polite" aria-relevant="additions text" className="mt-4 space-y-3">
            {entries.length === 0 && <p className="text-[13px] text-inkSoft">외국어 발언의 한국어 번역이 여기에 표시됩니다.</p>}
            {entries.map((entry) => (
              <article key={entry.id} className="min-h-24 rounded-xl border border-line bg-soft/30 p-4">
                <p className="text-[12px] font-bold text-inkSoft">{entry.speaker}</p>
                <p data-i18n-user-content className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-ink">{entry.korean || "번역 중…"}</p>
              </article>
            ))}
          </div>
        </section>
        <section aria-label="상대방 언어 회의 내용" className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-[16px] font-bold text-ink">상대방 언어</h3>
          <div role="log" aria-label="상대방 언어 실시간 기록" aria-live="polite" aria-relevant="additions text" className="mt-4 space-y-3">
            {entries.length === 0 && <p className="text-[13px] text-inkSoft">화자가 구분된 원문이 여기에 표시됩니다.</p>}
            {entries.map((entry) => (
              <article key={entry.id} className="min-h-24 rounded-xl border border-line bg-soft/30 p-4">
                <p className="text-[12px] font-bold text-inkSoft">{entry.speaker}</p>
                <p data-i18n-user-content className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-accent">{entry.original}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
      {(error || capture.error || speech.error) && <p role="alert" className="text-[13px] font-medium text-error">{error || capture.error || speech.error}</p>}
      <p className="text-[12px] leading-5 text-inkSoft">회의 오디오는 Soniox로 전송되고, 전사 텍스트는 설정된 번역 모델로 전송됩니다. 외부 제공자를 사용하면 해당 제공자의 정책과 사용량 기반 비용이 적용될 수 있습니다. 테스트 프로덕트 결과는 현재 화면에만 유지되고 자동 저장되지 않습니다. 번역 음성은 이 기기의 스피커에서 재생되며 다른 통화 앱으로 자동 전송되지는 않습니다.</p>
    </div>
  );
}
