"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectSonioxTts,
  getSonioxTtsSpeedPlan,
  type SonioxTtsSession,
} from "@/services/sonioxTts";

export type SonioxTtsPhase = "idle" | "connecting" | "playing" | "finished" | "error";

export interface SonioxSpeakOptions {
  text: string;
  language: string;
  voice: string;
  speed?: number;
}

const SAMPLE_RATE = 24_000;

function createAudioContext(): AudioContext {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("이 브라우저에서는 음성 재생을 지원하지 않습니다.");
  return new AudioContextConstructor({ sampleRate: SAMPLE_RATE });
}

/**
 * Realtime translation playback.
 *
 * The provider stream is opened ONLY when there is text to speak. An earlier
 * design pre-opened a "warm" stream at push-to-talk time and kept it alive by
 * reconnecting every few seconds, to save the handshake. That is what produced
 * the provider's 408 (request timeout): a stream that is configured but has not
 * been handed any text is on the provider's first-stream clock, and the gap
 * before the text arrives grows with the utterance — a long turn means a long
 * translation. The handshake costs a fraction of the translation that already
 * had to finish, so connecting late is both simpler and reliable.
 *
 * `prepare()` still exists, but only to unlock audio playback inside a user
 * gesture; it never touches the network.
 */
export function useSonioxTts() {
  const [phase, setPhase] = useState<SonioxTtsPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const contextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<SonioxTtsSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const carryByteRef = useRef<number | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the current utterance has produced audible output yet, and the
  // utterance itself so a stream that dies silently can be re-sent exactly once.
  const audioStartedRef = useRef(false);
  const pendingUtteranceRef = useRef<{ options: SonioxSpeakOptions; retried: boolean } | null>(null);
  const speakRef = useRef<((options: SonioxSpeakOptions, isRetry: boolean) => Promise<void>) | null>(null);

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current !== null) clearTimeout(finishTimerRef.current);
    finishTimerRef.current = null;
  }, []);

  const stopResources = useCallback((cancel: boolean) => {
    clearFinishTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    if (cancel) sessionRef.current?.cancel();
    else sessionRef.current?.close();
    sessionRef.current = null;
    audioStartedRef.current = false;
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    carryByteRef.current = null;
  }, [clearFinishTimer]);

  const ensureAudioContext = useCallback(async () => {
    let context = contextRef.current;
    if (!context || context.state === "closed") {
      context = createAudioContext();
      contextRef.current = context;
    }
    if (context.state === "suspended") await context.resume();
    return context;
  }, []);

  const scheduleAudio = useCallback((generation: number, chunk: Uint8Array, playbackRate: number) => {
    if (!mountedRef.current || generation !== generationRef.current) return;
    const context = contextRef.current;
    if (!context) return;

    let bytes = chunk;
    if (carryByteRef.current !== null) {
      const joined = new Uint8Array(chunk.length + 1);
      joined[0] = carryByteRef.current;
      joined.set(chunk, 1);
      bytes = joined;
      carryByteRef.current = null;
    }
    if (bytes.length % 2 === 1) {
      carryByteRef.current = bytes[bytes.length - 1];
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    if (bytes.length === 0) return;

    const sampleCount = bytes.length / 2;
    const buffer = context.createBuffer(1, sampleCount, SAMPLE_RATE);
    const samples = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(context.destination);
    sourcesRef.current.add(source);
    source.onended = () => sourcesRef.current.delete(source);
    const startAt = Math.max(context.currentTime + 0.01, nextStartTimeRef.current);
    source.start(startAt);
    // Past this point the other side has heard part of the sentence, so the
    // utterance can no longer be re-sent without repeating speech.
    audioStartedRef.current = true;
    nextStartTimeRef.current = startAt + (buffer.duration / playbackRate);
    setPhase("playing");
  }, []);

  const connectSession = useCallback((
    options: SonioxSpeakOptions,
    generation: number,
    controller: AbortController,
    context: AudioContext,
  ) => {
    const speedPlan = getSonioxTtsSpeedPlan(options.speed ?? 1);
    return connectSonioxTts({
      language: options.language,
      voice: options.voice,
      speed: speedPlan.providerSpeed,
      signal: controller.signal,
      onAudio: (chunk) => scheduleAudio(generation, chunk, speedPlan.playbackRate),
      onTerminated: () => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        sessionRef.current = null;
        abortRef.current = null;
        pendingUtteranceRef.current = null;
        const remainingMs = Math.max(0, (nextStartTimeRef.current - context.currentTime) * 1000);
        clearFinishTimer();
        finishTimerRef.current = setTimeout(() => {
          if (mountedRef.current && generation === generationRef.current) setPhase("finished");
        }, remainingMs);
      },
      onError: (message) => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        const pending = pendingUtteranceRef.current;
        if (pending && !pending.retried && !audioStartedRef.current) {
          // The stream died before a single sample played, so the other side
          // heard nothing. Re-send once on a fresh stream rather than surfacing
          // a failure the speaker cannot act on.
          const retryOptions = pending.options;
          stopResources(false);
          void speakRef.current?.(retryOptions, true);
          return;
        }
        stopResources(false);
        setError(message);
        setPhase("error");
      },
    });
  }, [clearFinishTimer, scheduleAudio, stopResources]);

  /** Unlock audio playback inside a user gesture. Never opens a provider stream. */
  const prepare = useCallback(async () => {
    const generation = generationRef.current;
    try {
      await ensureAudioContext();
      if (!mountedRef.current || generation !== generationRef.current) return;
      setError(null);
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      if ((caught as { name?: string }).name === "AbortError") return;
      const message = caught instanceof Error && !caught.message.startsWith("soniox_tts_")
        ? caught.message
        : "번역 음성을 시작할 수 없습니다.";
      setError(message);
      setPhase("error");
    }
  }, [ensureAudioContext]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    stopResources(true);
    pendingUtteranceRef.current = null;
    setError(null);
    setPhase("idle");
  }, [stopResources]);

  const speakInternal = useCallback(async (options: SonioxSpeakOptions, isRetry: boolean) => {
    const text = options.text.trim();
    if (!text) return;
    // `retried` carries across the resend so a second failure is surfaced rather
    // than starting another round.
    pendingUtteranceRef.current = { options, retried: isRetry };
    audioStartedRef.current = false;
    setError(null);
    setPhase("connecting");
    generationRef.current += 1;
    const generation = generationRef.current;

    try {
      const context = await ensureAudioContext();
      if (!mountedRef.current || generation !== generationRef.current) return;
      stopResources(true);
      const controller = new AbortController();
      abortRef.current = controller;
      nextStartTimeRef.current = context.currentTime + 0.03;
      const session = await connectSession(options, generation, controller, context);
      if (!mountedRef.current || generation !== generationRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      // The text goes out immediately after the handshake, so the provider's
      // first-stream window is never a factor.
      session.speak(text);
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      stopResources(true);
      const message = caught instanceof Error
        && caught.name !== "AbortError"
        && !caught.message.startsWith("soniox_tts_")
        ? caught.message
        : "번역 음성을 시작할 수 없습니다.";
      setError(message);
      setPhase("error");
    }
  }, [connectSession, ensureAudioContext, stopResources]);
  speakRef.current = speakInternal;

  const speak = useCallback(
    (options: SonioxSpeakOptions) => speakInternal(options, false),
    [speakInternal],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      stopResources(true);
      const context = contextRef.current;
      contextRef.current = null;
      void context?.close();
    };
  }, [stopResources]);

  return { phase, error, prepare, speak, stop };
}
