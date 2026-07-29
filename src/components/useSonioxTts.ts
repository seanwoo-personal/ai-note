"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectSonioxTts,
  type SonioxTtsSession,
} from "@/services/sonioxTts";

export type SonioxTtsPhase = "idle" | "connecting" | "playing" | "finished" | "error";

export interface SonioxSpeakOptions {
  text: string;
  language: string;
  voice: string;
  speed?: number;
}

export type SonioxPrepareOptions = Omit<SonioxSpeakOptions, "text">;

type WarmSession = {
  key: string;
  generation: number;
  promise: Promise<SonioxTtsSession>;
};

const SAMPLE_RATE = 24_000;

function sessionKey(options: SonioxPrepareOptions): string {
  return `${options.language}:${options.voice}:${options.speed ?? 1}`;
}

function createAudioContext(): AudioContext {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("이 브라우저에서는 음성 재생을 지원하지 않습니다.");
  return new AudioContextConstructor({ sampleRate: SAMPLE_RATE });
}

export function useSonioxTts() {
  const [phase, setPhase] = useState<SonioxTtsPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const contextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<SonioxTtsSession | null>(null);
  const warmSessionRef = useRef<WarmSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const carryByteRef = useRef<number | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    warmSessionRef.current = null;
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

  const scheduleAudio = useCallback((generation: number, chunk: Uint8Array) => {
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
    source.connect(context.destination);
    sourcesRef.current.add(source);
    source.onended = () => sourcesRef.current.delete(source);
    const startAt = Math.max(context.currentTime + 0.01, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;
    setPhase("playing");
  }, []);

  const connectSession = useCallback((
    options: SonioxPrepareOptions,
    generation: number,
    controller: AbortController,
    context: AudioContext,
  ) => connectSonioxTts({
    language: options.language,
    voice: options.voice,
    speed: options.speed ?? 1,
    signal: controller.signal,
    onAudio: (chunk) => scheduleAudio(generation, chunk),
    onTerminated: () => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      sessionRef.current = null;
      warmSessionRef.current = null;
      abortRef.current = null;
      const remainingMs = Math.max(0, (nextStartTimeRef.current - context.currentTime) * 1000);
      clearFinishTimer();
      finishTimerRef.current = setTimeout(() => {
        if (mountedRef.current && generation === generationRef.current) setPhase("finished");
      }, remainingMs);
    },
    onError: (message) => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      stopResources(false);
      setError(message);
      setPhase("error");
    },
  }), [clearFinishTimer, scheduleAudio, stopResources]);

  const prepare = useCallback(async (options?: SonioxPrepareOptions) => {
    let generation = generationRef.current;
    try {
      const context = await ensureAudioContext();
      setError(null);
      if (!options) return;
      const key = sessionKey(options);
      const current = warmSessionRef.current;
      if (current && current.key === key && current.generation === generationRef.current) {
        generation = current.generation;
        await current.promise;
        return;
      }

      generationRef.current += 1;
      generation = generationRef.current;
      stopResources(true);
      const controller = new AbortController();
      abortRef.current = controller;
      nextStartTimeRef.current = context.currentTime + 0.03;
      const promise = connectSession(options, generation, controller, context);
      warmSessionRef.current = { key, generation, promise };
      const session = await promise;
      if (!mountedRef.current || generation !== generationRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      if ((caught as { name?: string }).name === "AbortError") return;
      warmSessionRef.current = null;
      abortRef.current = null;
      const message = caught instanceof Error
        && !caught.message.startsWith("soniox_tts_")
        ? caught.message
        : "번역 음성을 시작할 수 없습니다.";
      setError(message);
      setPhase("error");
    }
  }, [connectSession, ensureAudioContext, stopResources]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    stopResources(true);
    setError(null);
    setPhase("idle");
  }, [stopResources]);

  const speak = useCallback(async (options: SonioxSpeakOptions) => {
    const text = options.text.trim();
    if (!text) return;
    setError(null);
    setPhase("connecting");
    const key = sessionKey(options);
    const prepared = warmSessionRef.current;
    let generation = generationRef.current;

    try {
      const context = await ensureAudioContext();
      let session: SonioxTtsSession;
      if (prepared && prepared.key === key && prepared.generation === generationRef.current) {
        generation = prepared.generation;
        session = await prepared.promise;
        if (!mountedRef.current || generation !== generationRef.current) {
          session.cancel();
          return;
        }
        warmSessionRef.current = null;
        sessionRef.current = session;
      } else {
        generationRef.current += 1;
        generation = generationRef.current;
        stopResources(true);
        const controller = new AbortController();
        abortRef.current = controller;
        nextStartTimeRef.current = context.currentTime + 0.03;
        session = await connectSession(options, generation, controller, context);
        if (!mountedRef.current || generation !== generationRef.current) {
          session.cancel();
          return;
        }
        sessionRef.current = session;
      }
      session.speak(text);
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      warmSessionRef.current = null;
      abortRef.current = null;
      const message = caught instanceof Error
        && caught.name !== "AbortError"
        && !caught.message.startsWith("soniox_tts_")
        ? caught.message
        : "번역 음성을 시작할 수 없습니다.";
      setError(message);
      setPhase("error");
    }
  }, [connectSession, ensureAudioContext, stopResources]);

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
