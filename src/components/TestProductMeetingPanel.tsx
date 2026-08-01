"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { AppDialog } from "@/components/AppDialog";
import { useOptionalAppPreferences } from "@/components/AppPreferences";
import { useOptionalRecorderSession } from "@/components/RecorderSessionProvider";
import { type useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";
import { type useSonioxTts } from "@/components/useSonioxTts";

import {
  buildGlobalMeetingDefaultTitle,
  buildGlobalMeetingMinutes,
  buildGlobalMeetingTranscript,
  type GlobalMeetingLogEntry,
} from "@/lib/globalMeetingTranscript";
import { type SonioxTranscript } from "@/services/sonioxRealtime";
import {
  isNearBottom,
  reduceScrollFollow,
  type ScrollFollowEvent,
  type ScrollFollowState,
} from "@/lib/meetingScrollFollow";
import {
  resolveMeetingPrimaryControl,
  type MeetingPrimaryKind,
} from "@/lib/meetingPrimaryControl";
import { SONIOX_TTS_SPEED_OPTIONS } from "@/services/sonioxTts";

const LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "zh", label: "중국어" },
  { value: "ja", label: "일본어" },
] as const;


const TTS_VOICES = ["Maya", "Daniel", "Mina", "Kenji"] as const;

const SPEED_LABELS: Record<string, string> = {
  "0.8": "느리게 (0.8×)",
  "1": "보통 (1.0×)",
  "1.2": "빠르게 (1.2×)",
  "1.5": "매우 빠르게 (1.5×)",
  "2": "최고 속도 (2.0×)",
};

function speedLabel(speed: number): string {
  return SPEED_LABELS[String(speed)] ?? `${speed}×`;
}

export interface GlobalMeetingLocation {
  workspaceId: string;
  folderId: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

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
  // When the outbound utterance code-switched, Soniox's two-way translation is
  // unreliable (target-language spans get re-translated back into Korean), so we
  // discard it and re-translate the full source text through the fallback route.
  codeSwitched: boolean;
};

function speakerLabel(speaker: string | null): string {
  return speaker ? `Speaker ${speaker}` : "Speaker";
}

function hasUtteranceAwaitingEndpoint(transcript: Capture["transcript"], userSpeaker?: string | null): boolean {
  // When a specific push-to-talk speaker is known, scope "awaiting" to THAT speaker's
  // own un-endpointed content. Another participant talking (global provisional) must
  // not make the user's already-finalized utterance look like it is still pending.
  if (userSpeaker) {
    const track = transcript.speakers[userSpeaker];
    if (track?.original.provisional.trim()) return true;
    if (!track) return false;
    const endpoint = [...(transcript.endpoints ?? [])].reverse().find((item) => item.speaker === userSpeaker);
    return endpoint ? track.original.final !== endpoint.originalFinal : Boolean(track.original.final.trim());
  }
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

export function TestProductMeetingPanel({ capture, speech, location }: {
  capture: Capture;
  speech: Speech;
  location?: GlobalMeetingLocation;
}) {
  const recorderSession = useOptionalRecorderSession();
  const appPreferences = useOptionalAppPreferences();
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [inputLanguage, setInputLanguage] = useState("ko");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [ttsVoice, setTtsVoice] = useState<(typeof TTS_VOICES)[number]>("Maya");
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [entries, setEntries] = useState<MeetingEntry[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(null);
  const [endingRequested, setEndingRequested] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const endedAtRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<string>("");
  const endInFlightRef = useRef(false);
  const locationRef = useRef(location);
  locationRef.current = location;
  const inputLanguageRef = useRef(inputLanguage);
  inputLanguageRef.current = inputLanguage;
  const targetLanguageRef = useRef(targetLanguage);
  targetLanguageRef.current = targetLanguage;
  const [translationQueue, setTranslationQueue] = useState<TranslationJob[]>([]);
  const [passiveTranslationQueue, setPassiveTranslationQueue] = useState<TranslationJob[]>([]);
  const [speechQueue, setSpeechQueue] = useState<Array<{ id: number; text: string; language: string; voice: (typeof TTS_VOICES)[number]; speed: number }>>([]);
  const [pushToTalkPhase, setPushToTalkPhase] = useState<PushToTalkPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [saveDialogStage, setSaveDialogStage] = useState<"save" | "confirm-discard">("save");
  const [followState, setFollowState] = useState<ScrollFollowState>("follow");
  const followStateRef = useRef<ScrollFollowState>("follow");
  const scrollRef = useRef<HTMLElement>(null);
  // True once a real user scroll gesture (wheel/touch/key) has been seen but not
  // yet consumed by the resulting scroll event. Auto-follow scrolls set no
  // gesture, so they can never be misread as the user scrolling up to read.
  const userScrollGestureRef = useRef(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [primaryVisible, setPrimaryVisible] = useState(true);
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
  const strandedSweepRef = useRef(false);
  const rightShiftHeldRef = useRef(false);
  const leftShiftHeldRef = useRef(false);
  const leftShiftChordedRef = useRef(false);
  const outboundIdRef = useRef(1_000_000);
  captureStopRef.current = capture.stop;
  speechStopRef.current = speech.stop;
  const active = ["requesting", "connecting", "listening", "paused", "finishing"].includes(capture.phase);
  const paused = capture.phase === "paused";

  const scrollTranscriptToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const dispatchFollow = useCallback((event: ScrollFollowEvent) => {
    const result = reduceScrollFollow(followStateRef.current, event);
    followStateRef.current = result.state;
    setFollowState(result.state);
    if (result.scrollToBottom) scrollTranscriptToBottom();
  }, [scrollTranscriptToBottom]);

  const noteUserScrollGesture = useCallback(() => {
    userScrollGestureRef.current = true;
  }, []);

  const resetSessionScrollState = useCallback(() => {
    userScrollGestureRef.current = false;
    dispatchFollow({ type: "reset-session" });
  }, [dispatchFollow]);

  const handleTranscriptScroll = useCallback((el: HTMLElement) => {
    const metrics = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    const gesture = userScrollGestureRef.current;
    // A scroll that lands near the bottom always (re)follows. A scroll away from
    // the bottom only enters user-reading when it came from a real user gesture.
    // Keep a pending gesture through intermediate near-bottom events so pointer
    // drags and inertial touch scrolling are not consumed before they move away.
    if (isNearBottom(metrics)) {
      dispatchFollow({ type: "user-scroll", metrics });
    } else if (gesture) {
      userScrollGestureRef.current = false;
      dispatchFollow({ type: "user-scroll", metrics });
    }
  }, [dispatchFollow]);

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
      // A code-switched utterance corrupts Soniox's two-way translation (spans in
      // the target language get re-translated back into the source), so drop the
      // live translation and re-derive the counterpart from the full source text.
      const trustLiveTranslation = !endpoint.codeSwitched;
      const translation = trustLiveTranslation ? liveTranslation : "";
      // Column semantics are content-based, never language-direction based: every
      // recognized source utterance stays in 입력 and its generated counterpart
      // stays in 번역, regardless of which supported language was spoken.
      nextEntries.push({ id: endpoint.id, speaker: speakerLabel(endpoint.speaker), original: translation, sourceLanguage, korean: original, direction: "incoming" });
      if (!translation && !["recording", "finalizing"].includes(pushToTalkPhase)) {
        nextJobs.push({ id: endpoint.id, text: original, targetLanguage: targetLanguageRef.current, kind: "incoming-counterpart" });
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
    let codeSwitched = false;
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
      if (endpoint.codeSwitched) codeSwitched = true;
    }

    return {
      text: parts.join(" ").trim(),
      translation: codeSwitched ? "" : translationParts.join(" ").trim(),
      targetLanguage,
      closingEndpointCount: closingEndpointId,
      speaker: inferredSpeaker,
      voice: ttsVoice,
      speed: ttsSpeed,
      codeSwitched,
    };
  };

  const enqueuePushToTalk = (frozen: FrozenPushToTalk) => {
    frozenPushToTalkRef.current = null;
    const { text, translation, targetLanguage: frozenTargetLanguage } = frozen;
    if (!text) {
      setError("Left Shift 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
      strandedSweepRef.current = true;
      setPushToTalkPhase("idle");
      return;
    }
    const id = outboundIdRef.current;
    outboundIdRef.current += 1;
    setEntries((current) => [
      ...current.filter((entry) => !(
        entry.direction === "incoming"
        && entry.id > pushToTalkEndpointRef.current
        && entry.id <= frozen.closingEndpointCount
        && entry.speaker === speakerLabel(frozen.speaker)
      )),
      {
        id,
        speaker: `${speakerLabel(frozen.speaker)} · Push-to-Talk`,
        original: translation,
        sourceLanguage: frozenTargetLanguage,
        korean: text,
        direction: "outbound" as const,
      },
    ]);
    // Rows from other speakers inside the PTT window kept their counterpart
    // suppressed; re-enqueue their translations once this PTT settles.
    strandedSweepRef.current = true;
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
    // Wait only when the RELEVANT utterance is still open. If the user's own words
    // were already captured this window (`frozen.text`), scope the check to the user
    // speaker so a concurrent participant's live speech cannot stall the broadcast
    // (H3). Otherwise keep the global check so a still-open utterance whose boundary
    // is merely delayed (H1) or arriving under a drifted speaker (H2) is awaited.
    const awaiting = frozen.text
      ? hasUtteranceAwaitingEndpoint(capture.transcript, frozen.speaker)
      : hasUtteranceAwaitingEndpoint(capture.transcript);
    if (!awaiting) {
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
    let hasMatchingEndpoint = postCloseEndpoints.some((endpoint) =>
      (endpoint.speaker ?? "unknown") === (finalizedSpeaker ?? "unknown"));
    if (!hasMatchingEndpoint && finalizedSpeaker) {
      // Diarization speaker-ID drift across repeated push-to-talk cycles: the pinned
      // speaker produced no closing boundary, yet a fresh final endpoint DID land right
      // after the user closed the segment. The just-pressed closing Left Shift is an
      // explicit "this was me" signal, so adopt the drifted speaker rather than losing
      // the utterance. Only adopt when the post-close boundaries come from exactly one
      // other speaker — an ambiguous set means a genuinely concurrent participant, whom
      // we must never broadcast on the user's behalf, so we keep waiting for the pin.
      const driftedSpeakers = new Set(postCloseEndpoints.map((endpoint) => endpoint.speaker ?? "unknown"));
      if (driftedSpeakers.size === 1) {
        const drifted = postCloseEndpoints.find((endpoint) => endpoint.speaker)?.speaker ?? null;
        if (drifted && drifted !== finalizedSpeaker) {
          finalizedSpeaker = drifted;
          userSpeakerRef.current = drifted;
          frozenPushToTalkRef.current = { ...frozen, speaker: drifted };
          hasMatchingEndpoint = true;
        }
      }
    }
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
    let timer = 0;
    // The deadline is an idle safety net for "the user pressed Left Shift twice
    // but there is nothing to finalize" — NOT an absolute cap on how long a valid
    // utterance may take to endpoint. A slow/long final can legitimately land well
    // after 8 s, so while an utterance is still genuinely making progress toward its
    // boundary we must keep waiting (the finalizing effect commits it the moment it
    // arrives). Progress is measured by OBSERVABLE TRANSCRIPT ADVANCEMENT — a new
    // endpoint, byte-different finalized text, or a non-empty byte-different provisional
    // rewrite (including same-length and shrink corrections) — NOT by the mere presence
    // of a provisional. A byte-identical (or cleared)
    // provisional that never endpoints will never endpoint on its own, so it must be
    // abandoned deterministically rather than re-arming forever. The known pin remains
    // authoritative; only one post-close candidate may contribute byte progress while
    // identity is unresolved, so concurrent/ambiguous participant speech cannot re-arm.
    let driftCandidateSpeaker: string | null = null;
    const progress = (transcript: SonioxTranscript) => {
      const speaker = userSpeakerRef.current;
      if (speaker) {
        const track = transcript.speakers[speaker]?.original;
        const endpoints = (transcript.endpoints ?? []).filter(
          (endpoint) => (endpoint.speaker ?? "unknown") === speaker,
        ).length;
        const driftCandidates = frozenPushToTalkRef.current?.text
          ? []
          : Object.entries(transcript.speakers).filter(([candidateSpeaker, candidateTrack]) =>
            candidateSpeaker !== speaker
            && (
              Boolean(candidateTrack.original.provisional)
              || candidateSpeaker === driftCandidateSpeaker
            ));
        const driftCandidate = driftCandidates.length === 1 ? driftCandidates[0] : null;
        driftCandidateSpeaker = driftCandidate?.[0] ?? null;
        const candidateOriginal = driftCandidate?.[1].original;
        return {
          endpoints,
          final: track?.final ?? "",
          provisional: track?.provisional ?? "",
          candidateSpeaker: driftCandidateSpeaker,
          candidateFinal: candidateOriginal?.final ?? "",
          candidateProvisional: candidateOriginal?.provisional ?? "",
          candidatePhase: candidateOriginal?.provisional
            ? "provisional"
            : candidateOriginal?.final
              ? "final"
              : "absent",
        };
      }
      return {
        endpoints: transcript.endpointCount,
        final: transcript.original.final,
        provisional: transcript.original.provisional,
        candidateSpeaker: null,
        candidateFinal: "",
        candidateProvisional: "",
        candidatePhase: "absent",
      };
    };
    let last = progress(captureRef.current.transcript);
    // A still-present but non-advancing provisional earns exactly ONE grace interval
    // (an imminent-but-slow boundary), then abandons — bounding the stall to two ticks.
    let graceUsed = false;
    // Progress extends the idle window, but never removes the absolute lifecycle bound.
    // Anchor the policy to a monotonic clock when finalizing begins: callback counts are
    // not elapsed time when a background tab/event loop is throttled or suspended.
    const absoluteDeadline = performance.now() + 32_000;
    const advanced = (next: ReturnType<typeof progress>) =>
      next.endpoints > last.endpoints
      || next.final !== last.final
      || (next.provisional !== "" && next.provisional !== last.provisional)
      || (
        next.candidateSpeaker !== null
        && next.candidateSpeaker === last.candidateSpeaker
        && (
          next.candidateFinal !== last.candidateFinal
          || (
            next.candidateProvisional !== ""
            && next.candidateProvisional !== last.candidateProvisional
          )
          || (last.candidatePhase === "provisional" && next.candidatePhase === "final")
        )
      );
    const arm = () => {
      timer = window.setTimeout(() => {
        if (generationRef.current !== generation) return;
        const current = progress(captureRef.current.transcript);
        if (performance.now() >= absoluteDeadline) {
          frozenPushToTalkRef.current = null;
          strandedSweepRef.current = true;
          setPushToTalkPhase("idle");
          setError("Left Shift 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
          return;
        }
        if (advanced(current)) {
          last = current;
          graceUsed = false;
          arm();
          return;
        }
        if (
          (current.provisional.trim() || current.candidateProvisional.trim())
          && !graceUsed
        ) {
          last = current;
          graceUsed = true;
          arm();
          return;
        }
        frozenPushToTalkRef.current = null;
        strandedSweepRef.current = true;
        setPushToTalkPhase("idle");
        setError("Left Shift 사이에서 완료된 발화를 찾지 못했습니다. 다시 시도해 주세요.");
      }, 8_000);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [pushToTalkPhase]);

  useEffect(() => {
    // Incoming rows that arrived while push-to-talk was recording/finalizing had
    // their counterpart job suppressed. If the PTT attempt aborted (timeout, no
    // finished utterance, meeting end) — or completed for a different speaker —
    // those rows would stay "번역 중…" forever. Re-enqueue exactly the rows that
    // still miss a counterpart and have no queued or in-flight job.
    if (!strandedSweepRef.current || pushToTalkPhase !== "idle") return;
    strandedSweepRef.current = false;
    const stranded = entries.filter((entry) =>
      entry.direction === "incoming" && !entry.original && entry.korean);
    if (stranded.length === 0) return;
    setTranslationQueue((queue) => {
      const queuedIds = new Set(queue.map((job) => job.id));
      const additions = stranded
        .filter((entry) => !queuedIds.has(entry.id))
        .map((entry) => ({
          id: entry.id,
          text: entry.korean,
          targetLanguage: targetLanguageRef.current,
          kind: "incoming-counterpart" as const,
        }));
      return additions.length > 0 ? [...queue, ...additions] : queue;
    });
  }, [entries, pushToTalkPhase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ShiftRight") {
        rightShiftHeldRef.current = true;
        return;
      }
      if (leftShiftHeldRef.current && event.code !== "ShiftLeft") {
        leftShiftChordedRef.current = true;
        return;
      }
      if (event.code !== "ShiftLeft" || rightShiftHeldRef.current || event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTextInputTarget(event.target)) return;
      if (capture.phase !== "listening") return;
      leftShiftHeldRef.current = true;
      leftShiftChordedRef.current = false;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ShiftRight") {
        rightShiftHeldRef.current = false;
        return;
      }
      if (event.code !== "ShiftLeft" || !leftShiftHeldRef.current) return;
      const standalone = !leftShiftChordedRef.current;
      leftShiftHeldRef.current = false;
      leftShiftChordedRef.current = false;
      if (standalone && capture.phase === "listening") togglePushToTalk();
    };
    const onBlur = () => {
      rightShiftHeldRef.current = false;
      leftShiftHeldRef.current = false;
      leftShiftChordedRef.current = false;
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
    sessionIdRef.current = crypto.randomUUID();
    sessionStartedAtRef.current = new Date().toISOString();
    endInFlightRef.current = false;
    resetSessionScrollState();
    setEntries([]);
    setTranslationQueue([]);
    setPassiveTranslationQueue([]);
    setSpeechQueue([]);
    setPushToTalkPhase("idle");
    setError(null);
    setSaveState("idle");
    setSavedMeetingId(null);
    setEndingRequested(false);
    setSaveDialogOpen(false);
    setMeetingTitle("");
    endedAtRef.current = "";
    speech.stop();
    capture.reset();
    void capture.start({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: inputLanguage, languageB: targetLanguage },
    });
  };

  const pauseMeeting = () => {
    capture.pause();
    speech.stop();
  };

  const resumeMeeting = () => {
    capture.resume();
  };

  const logEntries = (): GlobalMeetingLogEntry[] => entries.map((entry) => ({
    speaker: entry.speaker,
    korean: entry.korean,
    counterpart: entry.original,
    direction: entry.direction,
  }));

  const languageLabel = (value: string): string => LANGUAGES.find((language) => language.value === value)?.label ?? value;

  const prepareMeetingSave = () => {
    const preparedEntries = logEntries();
    const transcript = buildGlobalMeetingTranscript(preparedEntries, {
      inputLanguageLabel: languageLabel(inputLanguageRef.current),
      targetLanguageLabel: languageLabel(targetLanguageRef.current),
    });
    if (!transcript) {
      setEndingRequested(false);
      setSaveState("error");
      setError("저장할 대화가 없습니다. 발화가 기록된 뒤 다시 종료해 주세요.");
      return;
    }
    const endedAt = endedAtRef.current || new Date().toISOString();
    endedAtRef.current = endedAt;
    setMeetingTitle(buildGlobalMeetingDefaultTitle({
      startedAt: sessionStartedAtRef.current || endedAt,
      endedAt,
      entries: preparedEntries,
    }));
    setEndingRequested(false);
    setSaveState("idle");
    setSaveDialogStage("save");
    setSaveDialogOpen(true);
  };

  const reopenMeetingSave = () => {
    const preparedEntries = logEntries();
    if (preparedEntries.length === 0) {
      setSaveState("error");
      setError("저장할 대화가 없습니다. 발화가 기록된 뒤 다시 종료해 주세요.");
      return;
    }
    const endedAt = endedAtRef.current || new Date().toISOString();
    endedAtRef.current = endedAt;
    if (!meetingTitle.trim()) {
      setMeetingTitle(buildGlobalMeetingDefaultTitle({
        startedAt: sessionStartedAtRef.current || endedAt,
        endedAt,
        entries: preparedEntries,
      }));
    }
    setError(null);
    setSaveState("idle");
    setSaveDialogStage("save");
    setSaveDialogOpen(true);
  };

  // Discard the current unsaved in-memory meeting only. This never touches the
  // network: it cannot call the save endpoint and cannot delete any persisted
  // meeting. Existing saved meetings are unaffected.
  const discardMeeting = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    passiveAbortRef.current?.abort();
    processingRef.current = false;
    passiveProcessingRef.current = false;
    // Consume any endpoints already emitted by the current transcript so the
    // endpoint effect cannot re-materialize discarded rows before capture.reset()
    // clears the transcript.
    lastEndpointRef.current = captureRef.current.transcript.endpointCount;
    originalLengthsRef.current = {};
    translationLengthsRef.current = {};
    frozenPushToTalkRef.current = null;
    openingBoundaryRef.current = null;
    userSpeakerRef.current = null;
    sessionIdRef.current = null;
    sessionStartedAtRef.current = "";
    endedAtRef.current = "";
    endInFlightRef.current = false;
    setEntries([]);
    setTranslationQueue([]);
    setPassiveTranslationQueue([]);
    setSpeechQueue([]);
    setPushToTalkPhase("idle");
    setError(null);
    setSaveState("idle");
    setSavedMeetingId(null);
    setEndingRequested(false);
    setMeetingTitle("");
    setSaveDialogStage("save");
    setSaveDialogOpen(false);
    resetSessionScrollState();
    speech.stop();
    capture.reset();
  };

  const persistMeeting = () => {
    if (endInFlightRef.current) return;
    const preparedEntries = logEntries();
    const transcript = buildGlobalMeetingTranscript(preparedEntries, {
      inputLanguageLabel: languageLabel(inputLanguageRef.current),
      targetLanguageLabel: languageLabel(targetLanguageRef.current),
    });
    const title = meetingTitle.trim();
    if (!transcript || !title) {
      setSaveState("error");
      setError(!transcript
        ? "저장할 대화가 없습니다. 발화가 기록된 뒤 다시 종료해 주세요."
        : "회의록 이름을 입력해 주세요.");
      return;
    }
    const id = sessionIdRef.current ?? crypto.randomUUID();
    sessionIdRef.current = id;
    const startedAt = sessionStartedAtRef.current || new Date().toISOString();
    const minutesBody = buildGlobalMeetingMinutes({
      title,
      startedAt,
      endedAt: endedAtRef.current || startedAt,
      inputLanguageLabel: languageLabel(inputLanguageRef.current),
      targetLanguageLabel: languageLabel(targetLanguageRef.current),
      entries: preparedEntries,
    });
    endInFlightRef.current = true;
    setError(null);
    setSaveState("saving");
    void fetch(`/api/meetings/${id}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startedAt,
        durationMs: Math.max(0, new Date(endedAtRef.current || new Date().toISOString()).getTime() - new Date(startedAt).getTime()),
        transcript,
        minutesBody,
        title,
        ...(locationRef.current
          ? { workspaceId: locationRef.current.workspaceId, folderId: locationRef.current.folderId }
          : {}),
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("session_save_failed");
      const payload = await response.json().catch(() => ({})) as { id?: unknown };
      setSavedMeetingId(typeof payload.id === "string" ? payload.id : id);
      setSaveState("saved");
      setSaveDialogOpen(false);
    }).catch(() => {
      // Never clear the captured conversation or close the dialog on failure.
      setSaveState("error");
      setError("회의록을 저장하지 못했습니다. 대화는 그대로 남아 있으니 다시 시도해 주세요.");
    }).finally(() => {
      endInFlightRef.current = false;
    });
  };

  const endMeeting = () => {
    if (endInFlightRef.current || endingRequested) return;
    setError(null);
    setSaveState("idle");
    setEndingRequested(true);
    endedAtRef.current = new Date().toISOString();
    speech.stop();
    setSpeechQueue([]);
    strandedSweepRef.current = true;
    setPushToTalkPhase("idle");
    frozenPushToTalkRef.current = null;
    openingBoundaryRef.current = null;
    userSpeakerRef.current = null;
    capture.stop();
  };

  useEffect(() => {
    if (!endingRequested || !["idle", "finished", "error"].includes(capture.phase)) return;
    if (translationQueue.length > 0 || passiveTranslationQueue.length > 0 || processingRef.current || passiveProcessingRef.current) return;
    // Let the endpoint-processing effect commit the final Soniox boundary before
    // snapshotting. This preserves the utterance that was still in progress when
    // the user pressed “미팅 종료”.
    const timer = window.setTimeout(prepareMeetingSave, 0);
    return () => window.clearTimeout(timer);
  }, [capture.phase, endingRequested, entries, passiveTranslationQueue.length, translationQueue.length]);

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
  const liveKorean = liveOriginal;
  const liveCounterpart = liveTranslation;
  const inputLanguageLabel = languageLabel(inputLanguage);
  const targetLanguageLabel = languageLabel(targetLanguage);

  // Whenever the transcript/translation grows, the scroll machine decides whether
  // to jump to the newest content (only while "follow") or leave the user reading.
  useEffect(() => {
    dispatchFollow({ type: "content-updated" });
  }, [dispatchFollow, entries, liveKorean, liveCounterpart]);

  const primaryControl = resolveMeetingPrimaryControl({
    active,
    captureListening: capture.phase === "listening",
    hasUnsavedEntries: entries.length > 0 && saveState !== "saved",
    pushToTalkPhase,
    speechPhase: speech.phase,
    saving: saveState === "saving",
  });
  const runPrimaryControl = (kind: MeetingPrimaryKind) => {
    if (kind === "start") startMeeting();
    else if (kind === "reopen") reopenMeetingSave();
    else togglePushToTalk();
  };

  // Mirror the in-flow primary CTA in a floating action once it scrolls out of
  // view. Re-observe whenever the primary button's identity (kind) changes.
  const primaryKind = primaryControl?.kind ?? null;
  useEffect(() => {
    const el = primaryRef.current;
    setPrimaryVisible(true);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      for (const entry of observed) setPrimaryVisible(entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [primaryKind]);
  const summaryDraft = saveDialogOpen ? buildGlobalMeetingMinutes({
    title: meetingTitle,
    startedAt: sessionStartedAtRef.current || endedAtRef.current,
    endedAt: endedAtRef.current || sessionStartedAtRef.current,
    inputLanguageLabel,
    targetLanguageLabel,
    entries: logEntries(),
  }) : "";
  const registerNavigationBlocker = recorderSession?.registerNavigationBlocker;
  const unregisterNavigationBlocker = recorderSession?.unregisterNavigationBlocker;

  useEffect(() => {
    if (!registerNavigationBlocker || !unregisterNavigationBlocker) return;
    const hasUnsavedMeeting = active || (entries.length > 0 && saveState !== "saved");
    if (!hasUnsavedMeeting) return;
    registerNavigationBlocker({
      id: "global-meeting-unsaved-session",
      kind: "meeting_content_edit",
      phase: saveState === "saving" ? "saving" : "dirty",
      label: "글로벌 미팅 번역",
      discard: () => {
        speechRef.current.stop();
        captureRef.current.stop();
      },
      allowNavigation: (currentUrl, destinationUrl) => currentUrl === destinationUrl,
    });
    return () => unregisterNavigationBlocker("global-meeting-unsaved-session");
  }, [active, entries.length, registerNavigationBlocker, saveState, unregisterNavigationBlocker]);

  const connectionStatusLabel = pushToTalkPhase !== "idle"
    ? null
    : capture.phase === "requesting"
    ? "마이크 권한과 연결을 확인하는 중… 잠시 기다려 주세요."
    : capture.phase === "connecting"
      ? "실시간 번역 서버에 연결하는 중… 잠시 기다려 주세요."
      : capture.phase === "listening"
        ? "실시간 번역에 연결되었습니다. 마이크와 실시간 번역은 계속 실행됩니다. Left Shift로 내 송출 구간을 시작하세요."
        : null;
  const pushToTalkLabel = connectionStatusLabel ?? ({
    idle: "마이크와 실시간 번역은 계속 실행됩니다. Left Shift로 내 송출 구간을 시작하세요.",
    recording: "내 송출 구간 · 실시간 번역 및 음성 연결 준비 중… 말을 마치면 Left Shift를 다시 누르세요.",
    finalizing: "마지막 토큰 확정 중…",
    translating: "상대방 언어로 번역 중…",
    speaking: "번역 음성 송출 중…",
    sent: "송출 완료 · Left Shift를 눌러 다시 말할 수 있습니다.",
  }[pushToTalkPhase]);

  return (
    <div className="space-y-5">
      {/* Idle controls remain in flow so the floating start mirror appears only
          after the original leaves view. During an active meeting, controls stay
          pinned and bounded so pause/end/PTT remain reachable above history. */}
      <section
        data-testid="global-meeting-controls"
        data-surface="settings"
        className={`${active ? "sticky top-0 z-20 " : ""}max-h-[50dvh] overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-[0_8px_24px_-18px_rgba(42,36,32,.45)] sm:p-6 lg:max-h-none lg:overflow-visible`}
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-ink">자유 참여 글로벌 미팅</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">참석자 등록 없이 세션 화자를 자동 구분하고, 발화 언어를 발화마다 자동으로 인식해 선택한 상대방 언어로 계속 실시간 양방향 번역합니다.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
              <span>내 언어</span>
              <select
                aria-label="내 언어"
                value={inputLanguage}
                disabled={active}
                onChange={(event) => {
                  const next = event.target.value;
                  setInputLanguage(next);
                  if (targetLanguage === next) {
                    setTargetLanguage(LANGUAGES.find((language) => language.value !== next)?.value ?? "ko");
                  }
                }}
                className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink disabled:opacity-50"
              >
                {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-[13px] font-semibold text-ink">
              <span>상대방 언어</span>
              <select aria-label="상대방 언어" value={targetLanguage} disabled={active} onChange={(event) => setTargetLanguage(event.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink disabled:opacity-50">
                {LANGUAGES.filter((language) => language.value !== inputLanguage).map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
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
                {SONIOX_TTS_SPEED_OPTIONS.map((speed) => <option key={speed} value={speed}>{speedLabel(speed)}</option>)}
              </select>
              <span className="text-[11px] font-normal leading-5 text-inkSoft">1.5×·2.0×는 외부 음성 최대 1.3×로 생성한 뒤 이 기기에서 추가 가속합니다.</span>
            </label>
          </div>
          <p className="text-[12px] leading-5 text-inkSoft">‘내 언어’는 대화록에서 내 쪽으로 표시하고 번역할 선호 언어입니다. 실제 말하는 언어는 발화마다 자동으로 인식되어 한 회의에서 언어를 섞어 말해도 그대로 처리됩니다.</p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          {!active ? (
            entries.length > 0 && saveState !== "saved" ? (
              <button ref={primaryKind === "reopen" ? primaryRef : undefined} type="button" onClick={(event) => { event.currentTarget.blur(); reopenMeetingSave(); }} className="min-h-11 rounded-full ld-action-primary px-5 text-[14px] font-semibold text-bg">
                회의록 저장 계속
              </button>
            ) : (
              <button ref={primaryKind === "start" ? primaryRef : undefined} type="button" onClick={(event) => { event.currentTarget.blur(); startMeeting(); }} className="min-h-11 rounded-full ld-action-primary px-5 text-[14px] font-semibold text-bg">
                미팅 시작
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                onClick={(event) => { event.currentTarget.blur(); if (paused) resumeMeeting(); else pauseMeeting(); }}
                disabled={!paused && capture.phase !== "listening"}
                className="min-h-11 rounded-full ld-action-primary px-5 text-[14px] font-semibold text-bg disabled:opacity-40"
              >
                {paused ? "이어서 진행" : "일시정지"}
              </button>
              <button
                type="button"
                onClick={(event) => { event.currentTarget.blur(); endMeeting(); }}
                disabled={saveState === "saving"}
                className="min-h-11 rounded-full border border-error px-5 text-[14px] font-semibold text-error disabled:opacity-40"
              >
                미팅 종료
              </button>
            </>
          )}
          <button ref={primaryKind === "ptt-start" || primaryKind === "ptt-confirm" ? primaryRef : undefined} type="button" disabled={capture.phase !== "listening" || ["finalizing", "translating", "speaking"].includes(pushToTalkPhase) || ["connecting", "playing"].includes(speech.phase)} onClick={togglePushToTalk} className={`min-h-11 rounded-full border px-5 text-[14px] font-semibold disabled:opacity-40 ${pushToTalkPhase === "recording" ? "border-error bg-error/10 text-error" : "border-line text-accent"}`}>
            {pushToTalkPhase === "recording" ? "송출 구간 확정" : "송출 구간 시작"}
          </button>
        </div>

        {saveState !== "idle" && (
          <p role="status" className={`mt-4 text-[13px] font-medium ${saveState === "error" ? "text-error" : "text-ink"}`}>
            {saveState === "saving" && "회의록을 저장하는 중…"}
            {saveState === "saved" && (savedMeetingId
              ? <>회의록을 저장했습니다. <a href={`/meetings/${savedMeetingId}`} className="text-accent underline underline-offset-4">회의록 보기</a></>
              : "회의록을 저장했습니다.")}
            {saveState === "error" && "회의록을 저장하지 못했습니다. 대화는 그대로 남아 있으니 다시 시도해 주세요."}
          </p>
        )}
        {paused && (
          <p role="status" className="mt-2 text-[13px] font-medium text-inkSoft">일시정지됨 · 음성 처리가 멈췄습니다. “이어서 진행”을 누르면 같은 세션으로 계속합니다.</p>
        )}
        <div className="mt-4 rounded-xl border border-line bg-soft/40 p-4">
          <p className="text-[12px] font-bold text-ink">Push-to-Talk · Left Shift</p>
          <p role="status" aria-label="Push-to-Talk 상태" className="mt-1 text-[13px] leading-6 text-inkSoft">{pushToTalkLabel}</p>
          <p className="mt-1 text-[12px] leading-5 text-inkSoft">발화 중 실시간 번역과 TTS 연결을 미리 준비하고, 두 번째 Left Shift에서 경계를 확정해 즉시 음성 송출을 시작합니다. 첫 Push-to-Talk 구간에서 감지된 활성 화자를 이 세션의 내 화자로 자동 고정하므로 첫 구간에서는 다른 참석자가 동시에 말하지 않도록 해 주세요.</p>
        </div>
      </section>

      {!active && (
        <div
          aria-hidden="true"
          data-floating-primary-safe-space=""
          className="h-[5.5rem] sm:hidden"
        />
      )}
      <section
        ref={scrollRef}
        data-testid="global-meeting-transcript-scroll"
        data-surface="transcript"
        aria-label="대화 기록"
        onPointerDown={noteUserScrollGesture}
        onWheel={noteUserScrollGesture}
        onTouchMove={noteUserScrollGesture}
        onKeyDown={(event) => {
          if (["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " ", "Spacebar"].includes(event.key)) noteUserScrollGesture();
        }}
        onScroll={(event) => handleTranscriptScroll(event.currentTarget)}
        className="relative max-h-[60vh] overflow-y-auto rounded-2xl border border-line bg-bg"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-bg/95 px-4 py-2 text-[12px] font-bold text-inkSoft backdrop-blur sm:px-5">
          <span>대화 기록 · {inputLanguageLabel} ↔ {targetLanguageLabel}</span>
        </div>
        <table aria-label="글로벌 미팅 번역 대화록" aria-live="polite" aria-relevant="additions text" className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-line bg-soft/50">
              <th scope="col" className="w-1/2 border-r border-line px-4 py-3 text-left text-[13px] font-bold text-ink sm:px-5">입력</th>
              <th scope="col" className="w-1/2 px-4 py-3 text-left text-[13px] font-bold text-ink sm:px-5">번역</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !liveOriginal && (
              <tr aria-label="대화 없음">
                <td className="border-r border-line px-4 py-6 text-[13px] text-inkSoft sm:px-5">입력 발화가 여기에 이어집니다.</td>
                <td className="px-4 py-6 text-[13px] text-inkSoft sm:px-5">번역이 여기에 이어집니다.</td>
              </tr>
            )}
            {entries.map((entry) => {
              const ptt = entry.direction === "outbound";
              const textClass = ptt ? "font-bold text-ink" : "text-ink";
              const speaker = entry.speaker.replace(" · ", " ");
              const rowLabel = appPreferences
                ? appPreferences.t("{speaker} 대화 행", { speaker })
                : `${speaker} 대화 행`;
              return (
                <Fragment key={entry.id}>
                  <tr>
                    <td colSpan={2} className="border-b border-line/70 px-4 pt-3 text-left text-[12px] font-semibold text-inkSoft sm:px-5">{entry.speaker}</td>
                  </tr>
                  <tr aria-label={rowLabel} className="border-b border-line">
                    <td className="min-w-0 border-r border-line px-4 pb-4 pt-2 align-top sm:px-5">
                      <p className={`whitespace-pre-wrap break-words text-[15px] leading-7 ${textClass}`}>
                        {entry.korean ? <span data-i18n-user-content>{entry.korean}</span> : "번역 중…"}
                      </p>
                    </td>
                    <td className="min-w-0 px-4 pb-4 pt-2 align-top sm:px-5">
                      <p className={`whitespace-pre-wrap break-words text-[15px] leading-7 ${textClass}`}>
                        {entry.original ? <span data-i18n-user-content>{entry.original}</span> : "번역 중…"}
                      </p>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {liveOriginal && (
              <Fragment>
                <tr className="bg-soft/30">
                  <td colSpan={2} className="border-b border-line/70 px-4 pt-3 text-left text-[12px] font-semibold text-inkSoft sm:px-5">{speakerLabel(liveSpeaker)} <span>· 실시간</span></td>
                </tr>
                <tr
                  aria-label={appPreferences
                    ? appPreferences.t("{speaker} 실시간 대화 행", {
                        speaker: speakerLabel(liveSpeaker),
                      })
                    : `${speakerLabel(liveSpeaker)} 실시간 대화 행`}
                  className="bg-soft/30"
                >
                  <td className="min-w-0 border-r border-line px-4 pb-4 pt-2 align-top sm:px-5">
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">
                      {liveKorean ? <span data-i18n-user-content>{liveKorean}</span> : "실시간 번역 중…"}
                    </p>
                  </td>
                  <td className="min-w-0 px-4 pb-4 pt-2 align-top sm:px-5">
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">
                      {liveCounterpart ? <span data-i18n-user-content>{liveCounterpart}</span> : "실시간 번역 중…"}
                    </p>
                  </td>
                </tr>
              </Fragment>
            )}
          </tbody>
        </table>
        {followState === "user-reading" && (
          <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
            <button
              type="button"
              aria-label={appPreferences ? appPreferences.t("최신 내용 보기") : "최신 내용 보기"}
              onClick={() => {
                userScrollGestureRef.current = false;
                dispatchFollow({ type: "resume-request" });
              }}
              className="pointer-events-auto inline-flex min-h-11 items-center gap-1 rounded-full ld-action-primary px-4 text-[13px] font-semibold text-bg shadow-[0_8px_24px_-8px_rgba(42,36,32,.6)]"
            >
              {appPreferences ? appPreferences.t("최신 내용 보기") : "최신 내용 보기"} <span aria-hidden="true">↓</span>
            </button>
          </div>
        )}
      </section>
      {primaryControl && !primaryControl.disabled && !primaryVisible && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <button
            type="button"
            data-floating-primary=""
            aria-label={primaryControl.label}
            onClick={() => runPrimaryControl(primaryControl.kind)}
            className="pointer-events-auto inline-flex min-h-11 items-center rounded-full ld-action-primary px-6 text-[14px] font-semibold text-bg shadow-[0_10px_30px_-8px_rgba(42,36,32,.7)]"
          >
            {primaryControl.label}
          </button>
        </div>
      )}
      {(error || capture.error || speech.error) && <p role="alert" className="text-[13px] font-medium text-error">{error || capture.error || speech.error}</p>}
      <p className="text-[12px] leading-5 text-inkSoft">회의 오디오는 외부 서버로 전송됩니다. 실시간 번역 결과가 없거나 언어 혼용이 감지된 경우 전사 텍스트가 설정된 번역 모델로 전송됩니다. 번역 음성 생성을 위해 번역된 텍스트도 외부 서버로 전송됩니다. 외부 제공자를 사용하면 해당 제공자의 정책과 사용량 기반 비용이 적용될 수 있습니다. “미팅 종료”를 누르면 저장 팝업에서 회의록 이름을 확인한 뒤 선택한 폴더에 저장할 수 있으며 오디오 파일은 보존하지 않습니다. 번역 음성은 이 기기의 스피커에서 재생되며 다른 통화 앱으로 자동 전송되지는 않습니다.</p>
      <AppDialog
        open={saveDialogOpen}
        title={appPreferences ? appPreferences.t("회의록 저장") : "회의록 저장"}
        initialFocusRef={titleInputRef}
        dismissible={saveState !== "saving"}
        onDismiss={() => {
          setSaveDialogOpen(false);
          setSaveState("idle");
          setError(null);
        }}
      >
        {(dismiss) => saveDialogStage === "confirm-discard" ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-error/40 bg-error/5 p-4 text-[13px] leading-6 text-ink">
              <p className="font-semibold text-error">{appPreferences ? appPreferences.t("이 회의를 폐기할까요?") : "이 회의를 폐기할까요?"}</p>
              <p className="mt-2 text-inkSoft">{appPreferences ? appPreferences.t("폐기하면 지금까지의 대화가 사라지며 되돌릴 수 없습니다. 이 작업은 저장하지 않으며, 저장된 다른 회의록에는 영향을 주지 않습니다.") : "폐기하면 지금까지의 대화가 사라지며 되돌릴 수 없습니다. 이 작업은 저장하지 않으며, 저장된 다른 회의록에는 영향을 주지 않습니다."}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setSaveDialogStage("save")} className="min-h-11 rounded-full border border-line px-4 text-[13px] font-semibold text-accent">{appPreferences ? appPreferences.t("돌아가기") : "돌아가기"}</button>
              <button type="button" onClick={discardMeeting} className="min-h-11 rounded-full bg-error px-5 text-[13px] font-semibold text-bg">{appPreferences ? appPreferences.t("폐기 확정") : "폐기 확정"}</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-[13px] leading-6 text-inkSoft">
              회의 시간과 대화 내용을 바탕으로 기본 이름과 요약 초안을 만들었습니다. 이름을 수정하거나 그대로 저장하세요.
            </p>
            <label className="block text-[13px] font-semibold text-ink">
              회의록 이름
              <input
                ref={titleInputRef}
                aria-label="회의록 이름"
                value={meetingTitle}
                maxLength={200}
                disabled={saveState === "saving"}
                onChange={(event) => setMeetingTitle(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] text-ink disabled:opacity-50"
              />
            </label>
            <div className="rounded-xl border border-line bg-soft/40 p-4 text-[12px] leading-5 text-inkSoft">
              <p className="font-semibold text-ink">요약 초안</p>
              <p tabIndex={0} data-i18n-user-content className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap">{summaryDraft}</p>
            </div>
            {saveState === "error" && error && <p role="alert" className="text-[13px] font-medium text-error">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                disabled={saveState === "saving"}
                onClick={() => { setError(null); setSaveState("idle"); setSaveDialogStage("confirm-discard"); }}
                className="min-h-11 rounded-full border border-error px-4 text-[13px] font-semibold text-error disabled:opacity-40"
              >
                {appPreferences ? appPreferences.t("폐기하기") : "폐기하기"}
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" disabled={saveState === "saving"} onClick={() => dismiss("explicit_cancel")} className="min-h-11 rounded-full border border-line px-4 text-[13px] font-semibold text-accent disabled:opacity-40">취소</button>
                <button type="button" disabled={saveState === "saving" || !meetingTitle.trim()} onClick={persistMeeting} className="min-h-11 rounded-full ld-action-primary px-5 text-[13px] font-semibold text-bg disabled:opacity-40">
                  {saveState === "saving" ? "저장 중…" : saveState === "error" ? "회의록 저장 다시 시도" : "회의록 저장"}
                </button>
              </div>
            </div>
          </div>
        )}
      </AppDialog>
    </div>
  );
}
