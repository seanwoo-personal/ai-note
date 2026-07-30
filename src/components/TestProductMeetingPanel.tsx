"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { type useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";
import { type useSonioxTts } from "@/components/useSonioxTts";

const LANGUAGES = [
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
] as const;

const TTS_VOICES = ["Maya", "Daniel", "Mina", "Kenji"] as const;

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
  kind: "incoming" | "incoming-counterpart" | "outbound";
  voice?: (typeof TTS_VOICES)[number];
  speed?: number;
};

type PushToTalkPhase = "idle" | "recording" | "finalizing" | "translating" | "speaking" | "sent";

type FrozenPushToTalk = {
  text: string;
  translation: string;
  targetLanguage: string;
  closingEndpointCount: number;
  speaker: string | null;
  voice: (typeof TTS_VOICES)[number];
  speed: number;
};

function speakerLabel(speaker: string | null): string {
  return speaker ? `Speaker ${speaker}` : "Speaker";
}

function hasUtteranceAwaitingEndpoint(transcript: Capture["transcript"]): boolean {
  if (transcript.original.provisional.trim()) return true;
  const speaker = transcript.activeSpeaker;
  if (!speaker) {
    const hasDiarizedHistory = Object.keys(transcript.speakers).length > 0
      || (transcript.endpoints ?? []).some((item) => Boolean(item.speaker));
    if (hasDiarizedHistory) return false;
    const endpoint = [...(transcript.endpoints ?? [])].reverse().find((item) => !item.speaker);
    return endpoint ? transcript.original.final !== endpoint.originalFinal : Boolean(transcript.original.final.trim());
  }
  const track = transcript.speakers[speaker];
  if (!track) return false;
  const endpoint = [...(transcript.endpoints ?? [])].reverse().find((item) => item.speaker === speaker);
  return endpoint ? track.original.final !== endpoint.originalFinal : Boolean(track.original.final.trim());
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, a, summary, audio, video, [role='button'], [role='link'], [tabindex]:not([tabindex='-1']), [contenteditable]:not([contenteditable='false'])"));
}

export function TestProductMeetingPanel({ capture, speech }: { capture: Capture; speech: Speech }) {
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [ttsVoice, setTtsVoice] = useState<(typeof TTS_VOICES)[number]>("Maya");
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [entries, setEntries] = useState<MeetingEntry[]>([]);
  const [translationQueue, setTranslationQueue] = useState<TranslationJob[]>([]);
  const [passiveTranslationQueue, setPassiveTranslationQueue] = useState<TranslationJob[]>([]);
  const [speechQueue, setSpeechQueue] = useState<Array<{ id: number; text: string; language: string; voice: (typeof TTS_VOICES)[number]; speed: number }>>([]);
  const [pushToTalkPhase, setPushToTalkPhase] = useState<PushToTalkPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastEndpointRef = useRef(0);
  const originalLengthsRef = useRef<Record<string, number>>({});
  const translationLengthsRef = useRef<Record<string, number>>({});
  const processingRef = useRef(false);
  const passiveProcessingRef = useRef(false);
  const speechProcessingRef = useRef(false);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const passiveAbortRef = useRef<AbortController | null>(null);
  const captureStopRef = useRef(capture.stop);
  const speechStopRef = useRef(speech.stop);
  const pushToTalkEndpointRef = useRef(0);
  const openingBoundaryRef = useRef<number | null>(null);
  const pushToTalkLengthsRef = useRef<Record<string, number>>({});
  const pushToTalkTranslationLengthsRef = useRef<Record<string, number>>({});
  const frozenPushToTalkRef = useRef<FrozenPushToTalk | null>(null);
  const userSpeakerRef = useRef<string | null>(null);
  const rightShiftHeldRef = useRef(false);
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
      const previousTranslationLength = translationLengthsRef.current[speakerKey] ?? 0;
      const original = endpoint.originalFinal.slice(previousLength).trim();
      const liveTranslation = endpoint.translationFinal.slice(previousTranslationLength).trim();
      originalLengthsRef.current[speakerKey] = endpoint.originalFinal.length;
      translationLengthsRef.current[speakerKey] = endpoint.translationFinal.length;
      if (!original) continue;
      const sourceLanguage = endpoint.originalLanguage ?? "unknown";
      const koreanSource = sourceLanguage.startsWith("ko");
      const korean = koreanSource ? original : liveTranslation;
      const counterpart = koreanSource ? liveTranslation : original;
      nextEntries.push({ id: endpoint.id, speaker: speakerLabel(endpoint.speaker), original: counterpart, sourceLanguage, korean, direction: "incoming" });
      if (koreanSource && !counterpart && !["recording", "finalizing"].includes(pushToTalkPhase)) {
        nextJobs.push({ id: endpoint.id, text: original, targetLanguage, kind: "incoming-counterpart" });
      } else if (!koreanSource && !korean) {
        nextJobs.push({ id: endpoint.id, text: original, targetLanguage: "ko", kind: "incoming" });
      }
    }
    if (nextEntries.length) setEntries((current) => [...current, ...nextEntries]);
    if (nextJobs.length) setPassiveTranslationQueue((current) => [...current, ...nextJobs]);
  }, [capture.transcript.endpointCount, capture.transcript.endpoints, pushToTalkPhase, targetLanguage]);

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
        setSpeechQueue((current) => [...current, {
          id: job.id,
          text: translated,
          language: job.targetLanguage,
          voice: (job.voice ?? "Maya") as (typeof TTS_VOICES)[number],
          speed: job.speed ?? 1,
        }]);
        setPushToTalkPhase("speaking");
      }
    }).catch((reason: unknown) => {
      if (((reason as { name?: string }).name !== "AbortError" || timedOut) && generationRef.current === generation) {
        setError(job.kind === "outbound"
          ? "내 발화를 상대방 언어로 번역하지 못했습니다. 다시 시도해 주세요."
          : job.kind === "incoming-counterpart"
            ? "상대방 언어 번역에 실패했습니다. 다음 발언은 계속 처리합니다."
            : "한국어 번역에 실패했습니다. 다음 발언은 계속 처리합니다.");
        if (job.kind === "outbound") setPushToTalkPhase("idle");
      }
    }).finally(() => {
      window.clearTimeout(timeout);
      if (generationRef.current === generation) {
        setTranslationQueue((current) => current[0]?.id === job.id ? current.slice(1) : current.filter((item) => item.id !== job.id));
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
        processingRef.current = false;
      }
    });
  }, [translationQueue]);

  useEffect(() => {
    if (passiveProcessingRef.current || passiveTranslationQueue.length === 0) return;
    const job = passiveTranslationQueue[0];
    const generation = generationRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20_000);
    passiveProcessingRef.current = true;
    passiveAbortRef.current = controller;
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
    }).catch((reason: unknown) => {
      if (((reason as { name?: string }).name !== "AbortError" || timedOut) && generationRef.current === generation) {
        setError(job.kind === "incoming-counterpart"
          ? "상대방 언어 번역에 실패했습니다. 다음 발언은 계속 처리합니다."
          : "한국어 번역에 실패했습니다. 다음 발언은 계속 처리합니다.");
      }
    }).finally(() => {
      window.clearTimeout(timeout);
      if (generationRef.current === generation) {
        setPassiveTranslationQueue((current) => current[0]?.id === job.id ? current.slice(1) : current.filter((item) => item.id !== job.id));
      }
      if (passiveAbortRef.current === controller) {
        passiveAbortRef.current = null;
        passiveProcessingRef.current = false;
      }
    });
  }, [passiveTranslationQueue]);

  useEffect(() => {
    const openingCount = openingBoundaryRef.current;
    if (openingCount === null || capture.transcript.endpointCount <= openingCount) return;
    const boundary = (capture.transcript.endpoints ?? []).find((endpoint) => endpoint.id > openingCount && endpoint.kind === "fin");
    if (!boundary) return;
    openingBoundaryRef.current = null;
    pushToTalkEndpointRef.current = boundary.id;
    const speakerKey = boundary.speaker ?? "unknown";
    pushToTalkLengthsRef.current[speakerKey] = boundary.originalFinal.length;
    pushToTalkTranslationLengthsRef.current[speakerKey] = boundary.translationFinal.length;
    const frozen = frozenPushToTalkRef.current;
    if (frozen && frozen.closingEndpointCount < boundary.id) {
      frozenPushToTalkRef.current = { ...frozen, closingEndpointCount: boundary.id };
    }
  }, [capture.transcript.endpointCount, capture.transcript.endpoints]);

  useEffect(() => {
    if (speechProcessingRef.current || speechQueue.length === 0 || !["idle", "finished", "error"].includes(speech.phase)) return;
    const item = speechQueue[0];
    const generation = generationRef.current;
    speechProcessingRef.current = true;
    void speech.speak({ text: item.text, language: item.language, voice: item.voice, speed: item.speed }).catch(() => {
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

  const freezePushToTalk = (closingEndpointId = capture.transcript.endpointCount): FrozenPushToTalk => {
    const latestPushToTalkEndpoint = [...(capture.transcript.endpoints ?? [])]
      .reverse()
      .find((endpoint) => endpoint.id > pushToTalkEndpointRef.current);
    const inferredSpeaker = userSpeakerRef.current
      ?? capture.transcript.activeSpeaker
      ?? latestPushToTalkEndpoint?.speaker
      ?? null;
    if (inferredSpeaker) userSpeakerRef.current = inferredSpeaker;
    const endpointSpeaker = inferredSpeaker ?? "unknown";
    const endpoints = (capture.transcript.endpoints ?? []).filter((endpoint) =>
      endpoint.id > pushToTalkEndpointRef.current
      && endpoint.id <= closingEndpointId
      && (endpoint.speaker ?? "unknown") === endpointSpeaker);
    const lengths = { ...pushToTalkLengthsRef.current };
    const translationLengths = { ...pushToTalkTranslationLengthsRef.current };
    const parts: string[] = [];
    const translationParts: string[] = [];
    for (const endpoint of endpoints) {
      const speakerKey = endpoint.speaker ?? "unknown";
      const previousLength = lengths[speakerKey] ?? 0;
      const previousTranslationLength = translationLengths[speakerKey] ?? 0;
      const text = endpoint.originalFinal.slice(previousLength).trim();
      const translated = endpoint.translationFinal.slice(previousTranslationLength).trim();
      lengths[speakerKey] = endpoint.originalFinal.length;
      translationLengths[speakerKey] = endpoint.translationFinal.length;
      if (text) parts.push(text);
      if (translated) translationParts.push(translated);
    }

    return {
      text: parts.join(" ").trim(),
      translation: translationParts.join(" ").trim(),
      targetLanguage,
      closingEndpointCount: capture.transcript.endpointCount,
      speaker: inferredSpeaker,
      voice: ttsVoice,
      speed: ttsSpeed,
    };
  };

  const enqueuePushToTalk = (frozen: FrozenPushToTalk) => {
    frozenPushToTalkRef.current = null;
    const { text, translation, targetLanguage: frozenTargetLanguage } = frozen;
    if (!text) {
      setError("Left Shift 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
      setPushToTalkPhase("idle");
      return;
    }
    const id = outboundIdRef.current;
    outboundIdRef.current += 1;
    setEntries((current) => [...current, {
      id,
      speaker: `${speakerLabel(frozen.speaker)} · Push-to-Talk`,
      original: translation,
      sourceLanguage: frozenTargetLanguage,
      korean: text,
      direction: "outbound",
    }]);
    if (translation) {
      setSpeechQueue((current) => [...current, { id, text: translation, language: frozenTargetLanguage, voice: frozen.voice, speed: frozen.speed }]);
      setPushToTalkPhase("speaking");
    } else {
      setTranslationQueue((current) => [...current, {
        id,
        text,
        targetLanguage: frozenTargetLanguage,
        kind: "outbound",
        voice: frozen.voice,
        speed: frozen.speed,
      }]);
      setPushToTalkPhase("translating");
    }
    setError(null);
  };

  const togglePushToTalk = () => {
    if (capture.phase !== "listening" || ["finalizing", "translating", "speaking"].includes(pushToTalkPhase) || ["connecting", "playing"].includes(speech.phase)) return;
    if (pushToTalkPhase !== "recording") {
      pushToTalkEndpointRef.current = capture.transcript.endpointCount;
      pushToTalkLengthsRef.current = Object.fromEntries(
        Object.entries(capture.transcript.speakers).map(([speaker, track]) => [speaker, `${track.original.final}${track.original.provisional}`.length]),
      );
      pushToTalkTranslationLengthsRef.current = Object.fromEntries(
        Object.entries(capture.transcript.speakers).map(([speaker, track]) => [speaker, `${track.translation.final}${track.translation.provisional}`.length]),
      );
      pushToTalkLengthsRef.current.unknown = `${capture.transcript.original.final}${capture.transcript.original.provisional}`.length;
      pushToTalkTranslationLengthsRef.current.unknown = `${capture.transcript.translation.final}${capture.transcript.translation.provisional}`.length;
      openingBoundaryRef.current = capture.transcript.endpointCount;
      capture.finalize();
      setPushToTalkPhase("recording");
      setError(null);
      void speech.prepare({ language: targetLanguage, voice: ttsVoice, speed: ttsSpeed });
      return;
    }
    const frozen = freezePushToTalk();
    frozenPushToTalkRef.current = frozen;
    capture.finalize();
    if (!hasUtteranceAwaitingEndpoint(capture.transcript)) {
      enqueuePushToTalk(frozen);
    } else {
      setPushToTalkPhase("finalizing");
    }
  };

  useEffect(() => {
    const frozen = frozenPushToTalkRef.current;
    if (pushToTalkPhase !== "finalizing" || !frozen || capture.transcript.endpointCount <= frozen.closingEndpointCount) return;
    const postCloseEndpoints = (capture.transcript.endpoints ?? []).filter((endpoint) =>
      endpoint.id > frozen.closingEndpointCount && endpoint.kind === "fin");
    let finalizedSpeaker = frozen.speaker;
    if (!finalizedSpeaker) {
      finalizedSpeaker = postCloseEndpoints.find((endpoint) => endpoint.speaker)?.speaker ?? null;
      if (finalizedSpeaker) {
        userSpeakerRef.current = finalizedSpeaker;
        frozenPushToTalkRef.current = { ...frozen, speaker: finalizedSpeaker };
      }
    }
    const hasMatchingEndpoint = postCloseEndpoints.some((endpoint) =>
      (endpoint.speaker ?? "unknown") === (finalizedSpeaker ?? "unknown"));
    if (!hasMatchingEndpoint) return;
    const closingEndpoint = postCloseEndpoints.find((endpoint) =>
      (endpoint.speaker ?? "unknown") === (finalizedSpeaker ?? "unknown"));
    if (!closingEndpoint) return;
    const finalized = freezePushToTalk(closingEndpoint.id);
    enqueuePushToTalk({ ...finalized, targetLanguage: frozen.targetLanguage });
  }, [capture.transcript, pushToTalkPhase]);

  useEffect(() => {
    if (pushToTalkPhase !== "finalizing") return;
    const generation = generationRef.current;
    const timer = window.setTimeout(() => {
      if (generationRef.current !== generation) return;
      frozenPushToTalkRef.current = null;
      setPushToTalkPhase("idle");
      setError("Left Shift 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pushToTalkPhase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ShiftRight") {
        rightShiftHeldRef.current = true;
        return;
      }
      if (event.code !== "ShiftLeft" || rightShiftHeldRef.current || event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTextInputTarget(event.target)) return;
      if (capture.phase !== "listening") return;
      event.preventDefault();
      togglePushToTalk();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ShiftRight") rightShiftHeldRef.current = false;
    };
    const onBlur = () => {
      rightShiftHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  });

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    passiveAbortRef.current?.abort();
    captureStopRef.current();
    speechStopRef.current();
  }, []);

  const startMeeting = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    passiveAbortRef.current?.abort();
    processingRef.current = false;
    passiveProcessingRef.current = false;
    lastEndpointRef.current = 0;
    originalLengthsRef.current = {};
    translationLengthsRef.current = {};
    frozenPushToTalkRef.current = null;
    openingBoundaryRef.current = null;
    userSpeakerRef.current = null;
    setEntries([]);
    setTranslationQueue([]);
    setPassiveTranslationQueue([]);
    setSpeechQueue([]);
    setPushToTalkPhase("idle");
    setError(null);
    speech.stop();
    capture.reset();
    void capture.start({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "ko", languageB: targetLanguage },
    });
  };

  const stopMeeting = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    passiveAbortRef.current?.abort();
    processingRef.current = false;
    passiveProcessingRef.current = false;
    capture.stop();
    speech.stop();
    frozenPushToTalkRef.current = null;
    openingBoundaryRef.current = null;
    userSpeakerRef.current = null;
    setTranslationQueue([]);
    setPassiveTranslationQueue([]);
    setSpeechQueue([]);
    setPushToTalkPhase("idle");
  };

  const liveSpeaker = capture.transcript.activeSpeaker;
  const liveSpeakerKey = liveSpeaker ?? "unknown";
  const liveTrack = liveSpeaker ? capture.transcript.speakers[liveSpeaker] : null;
  const liveOriginalTrack = liveTrack
    ? `${liveTrack.original.final}${liveTrack.original.provisional}`
    : `${capture.transcript.original.final}${capture.transcript.original.provisional}`;
  const liveTranslationTrack = liveTrack
    ? `${liveTrack.translation.final}${liveTrack.translation.provisional}`
    : `${capture.transcript.translation.final}${capture.transcript.translation.provisional}`;
  const liveOriginal = liveOriginalTrack.slice(originalLengthsRef.current[liveSpeakerKey] ?? 0).trim();
  const liveTranslation = liveTranslationTrack.slice(translationLengthsRef.current[liveSpeakerKey] ?? 0).trim();
  const liveSourceLanguage = liveTrack?.originalLanguage ?? "unknown";
  const liveKorean = liveSourceLanguage.startsWith("ko") ? liveOriginal : liveTranslation;
  const liveCounterpart = liveSourceLanguage.startsWith("ko") ? liveTranslation : liveOriginal;

  const pushToTalkLabel = {
    idle: "마이크와 실시간 번역은 계속 실행됩니다. Left Shift로 내 송출 구간을 시작하세요.",
    recording: "내 송출 구간 · 실시간 번역 및 음성 연결 준비 중… 말을 마치면 Left Shift를 다시 누르세요.",
    finalizing: "마지막 토큰 확정 중…",
    translating: "상대방 언어로 번역 중…",
    speaking: "번역 음성 송출 중…",
    sent: "송출 완료 · Left Shift를 눌러 다시 말할 수 있습니다.",
  }[pushToTalkPhase];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-ink">자유 참여 글로벌 미팅</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">참석자 등록 없이 Soniox가 세션 화자를 자동 구분하고, 한국어와 선택한 상대 언어를 계속 실시간 양방향 번역합니다.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
              <span>내 송출 대상 언어</span>
              <select aria-label="내 송출 대상 언어" value={targetLanguage} disabled={active} onChange={(event) => setTargetLanguage(event.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink disabled:opacity-50">
                {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
              <span>번역 음성</span>
              <select aria-label="번역 음성" value={ttsVoice} disabled={active} onChange={(event) => setTtsVoice(event.target.value as (typeof TTS_VOICES)[number])} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink disabled:opacity-50">
                {TTS_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
              <span>음성 속도</span>
              <select aria-label="음성 속도" value={ttsSpeed} disabled={active} onChange={(event) => setTtsSpeed(Number(event.target.value))} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink disabled:opacity-50">
                <option value={0.8}>느리게 (0.8×)</option>
                <option value={1}>보통 (1.0×)</option>
                <option value={1.2}>빠르게 (1.2×)</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={(event) => {
            event.currentTarget.blur();
            if (active) stopMeeting();
            else startMeeting();
          }} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg">
            {active ? "미팅 중지" : "미팅 시작"}
          </button>
          <button type="button" disabled={capture.phase !== "listening" || ["finalizing", "translating", "speaking"].includes(pushToTalkPhase) || ["connecting", "playing"].includes(speech.phase)} onClick={togglePushToTalk} className={`min-h-11 rounded-full border px-5 text-[14px] font-semibold disabled:opacity-40 ${pushToTalkPhase === "recording" ? "border-error bg-error/10 text-error" : "border-line text-accent"}`}>
            {pushToTalkPhase === "recording" ? "송출 구간 확정" : "송출 구간 시작"}
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-soft/40 p-4">
          <p className="text-[12px] font-bold text-ink">Push-to-Talk · Left Shift</p>
          <p role="status" aria-label="Push-to-Talk 상태" className="mt-1 text-[13px] leading-6 text-inkSoft">{pushToTalkLabel}</p>
          <p className="mt-1 text-[12px] leading-5 text-inkSoft">발화 중 Soniox 번역과 TTS 연결을 미리 준비하고, 두 번째 Left Shift에서 경계를 확정해 즉시 음성 송출을 시작합니다. 첫 Push-to-Talk 구간에서 감지된 활성 화자를 이 세션의 내 화자로 자동 고정하므로 첫 구간에서는 다른 참석자가 동시에 말하지 않도록 해 주세요.</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <table aria-label="Global Meeting 대화록" aria-live="polite" aria-relevant="additions text" className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-line bg-soft/50">
              <th scope="col" className="w-1/2 border-r border-line px-4 py-3 text-left text-[13px] font-bold text-ink sm:px-5">한국어</th>
              <th scope="col" className="w-1/2 px-4 py-3 text-left text-[13px] font-bold text-ink sm:px-5">상대방 언어</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !liveOriginal && (
              <tr aria-label="대화 없음">
                <td className="border-r border-line px-4 py-6 text-[13px] text-inkSoft sm:px-5">한국어 번역이 여기에 이어집니다.</td>
                <td className="px-4 py-6 text-[13px] text-inkSoft sm:px-5">상대방 언어가 여기에 이어집니다.</td>
              </tr>
            )}
            {entries.map((entry) => {
              const ptt = entry.direction === "outbound";
              const textClass = ptt ? "font-bold italic text-error" : "text-ink";
              const rowLabel = ptt
                ? `${entry.speaker.replace(" · ", " ")} 대화`
                : `${entry.speaker} 대화`;
              return (
                <Fragment key={entry.id}>
                  <tr>
                    <td colSpan={2} className="border-b border-line/70 px-4 pt-3 text-left text-[12px] font-semibold text-inkSoft sm:px-5">{entry.speaker}</td>
                  </tr>
                  <tr aria-label={rowLabel} className="border-b border-line">
                    <td className="min-w-0 border-r border-line px-4 pb-4 pt-2 align-top sm:px-5">
                      <p data-i18n-user-content className={`whitespace-pre-wrap break-words text-[15px] leading-7 ${textClass}`}>{entry.korean || "번역 중…"}</p>
                    </td>
                    <td className="min-w-0 px-4 pb-4 pt-2 align-top sm:px-5">
                      <p data-i18n-user-content className={`whitespace-pre-wrap break-words text-[15px] leading-7 ${textClass}`}>{entry.original || "번역 중…"}</p>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {liveOriginal && (
              <Fragment>
                <tr className="bg-soft/30">
                  <td colSpan={2} className="border-b border-line/70 px-4 pt-3 text-left text-[12px] font-semibold text-inkSoft sm:px-5">{speakerLabel(liveSpeaker)} · 실시간</td>
                </tr>
                <tr aria-label={`${speakerLabel(liveSpeaker)} 실시간 대화`} className="bg-soft/30">
                  <td className="min-w-0 border-r border-line px-4 pb-4 pt-2 align-top sm:px-5">
                    <p data-i18n-user-content className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{liveKorean || "실시간 번역 중…"}</p>
                  </td>
                  <td className="min-w-0 px-4 pb-4 pt-2 align-top sm:px-5">
                    <p data-i18n-user-content className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{liveCounterpart || "실시간 번역 중…"}</p>
                  </td>
                </tr>
              </Fragment>
            )}
          </tbody>
        </table>
      </section>
      {(error || capture.error || speech.error) && <p role="alert" className="text-[13px] font-medium text-error">{error || capture.error || speech.error}</p>}
      <p className="text-[12px] leading-5 text-inkSoft">회의 오디오는 Soniox로 전송됩니다. Soniox 실시간 번역 결과가 없는 경우에만 전사 텍스트가 설정된 번역 모델로 전송됩니다. 번역 음성 생성을 위해 번역된 텍스트도 Soniox로 전송됩니다. 외부 제공자를 사용하면 해당 제공자의 정책과 사용량 기반 비용이 적용될 수 있습니다. Global Meeting 결과는 현재 화면에만 유지되고 자동 저장되지 않습니다. 번역 음성은 이 기기의 스피커에서 재생되며 다른 통화 앱으로 자동 전송되지는 않습니다.</p>
    </div>
  );
}
