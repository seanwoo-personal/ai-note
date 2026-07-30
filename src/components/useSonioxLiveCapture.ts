"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectSonioxRealtime,
  emptySonioxTranscript,
  type SonioxContext,
  type SonioxRealtimeSession,
  type SonioxTranscript,
  type SonioxTranslationOptions,
} from "@/services/sonioxRealtime";

export type SonioxInputSource = "microphone" | "browser-tab";
export type SonioxCapturePhase =
  | "idle"
  | "requesting"
  | "connecting"
  | "listening"
  | "paused"
  | "finishing"
  | "finished"
  | "error";

export interface SonioxCaptureStartOptions {
  inputSource: SonioxInputSource;
  translation: SonioxTranslationOptions;
  context?: SonioxContext;
}

const LANGUAGE_HINTS = ["ko", "en", "ja", "zh"];

async function requestCaptureStream(inputSource: SonioxInputSource): Promise<MediaStream> {
  if (inputSource === "browser-tab") {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("공유한 탭에 오디오가 없습니다. '탭 오디오 공유'를 켜고 다시 시도하세요.");
    }
    return stream;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function useSonioxLiveCapture() {
  const [phase, setPhase] = useState<SonioxCapturePhase>("idle");
  const phaseRef = useRef<SonioxCapturePhase>("idle");
  const [transcript, setTranscript] = useState<SonioxTranscript>(emptySonioxTranscript);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<SonioxRealtimeSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const finalizeRequestRef = useRef<{ generation: number; stage: "pausing" | "flushing" } | null>(null);
  const queuedFinalizeRef = useRef(false);

  const transitionPhase = useCallback((next: SonioxCapturePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const closeCurrent = useCallback(() => {
    finalizeRequestRef.current = null;
    queuedFinalizeRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onpause = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    sessionRef.current?.close();
    sessionRef.current = null;
    stopTracks();
  }, [stopTracks]);

  const failCurrent = useCallback((generation: number, message: string) => {
    if (!mountedRef.current || generation !== generationRef.current) return;
    generationRef.current += 1;
    closeCurrent();
    setError(message);
    transitionPhase("error");
  }, [closeCurrent, transitionPhase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      closeCurrent();
    };
  }, [closeCurrent]);

  const start = useCallback(async (options: SonioxCaptureStartOptions) => {
    if (["requesting", "connecting", "listening", "finishing"].includes(phaseRef.current)) return;
    transitionPhase("requesting");
    closeCurrent();
    const generation = ++generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setTranscript(emptySonioxTranscript());
    try {
      const sourceStream = await requestCaptureStream(options.inputSource);
      if (!mountedRef.current || generation !== generationRef.current) {
        sourceStream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = sourceStream;
      transitionPhase("connecting");
      const session = await connectSonioxRealtime({
        translation: options.translation,
        languageHints: LANGUAGE_HINTS,
        context: options.context,
        signal: controller.signal,
        onTranscript: (next) => {
          if (mountedRef.current && generation === generationRef.current) setTranscript(next);
        },
        onError: (message) => failCurrent(generation, message),
        onFinished: () => {
          if (!mountedRef.current || generation !== generationRef.current) return;
          generationRef.current += 1;
          const recorder = recorderRef.current;
          recorderRef.current = null;
          if (recorder) {
            recorder.ondataavailable = null;
            recorder.onstop = null;
            recorder.onerror = null;
            if (recorder.state !== "inactive") recorder.stop();
          }
          sessionRef.current?.close();
          sessionRef.current = null;
          abortRef.current = null;
          stopTracks();
          transitionPhase("finished");
        },
      });
      if (!mountedRef.current || generation !== generationRef.current) {
        session.close();
        stopTracks();
        return;
      }
      sessionRef.current = session;

      // getDisplayMedia requires a video track for the picker, but Soniox must receive audio only.
      // Keep sourceStream for complete cleanup while recording from a separate audio-only wrapper.
      const recordingStream = new MediaStream(sourceStream.getAudioTracks());
      const recorder = new MediaRecorder(recordingStream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (generation !== generationRef.current) return;
        if (event.data.size > 0) sessionRef.current?.sendAudio(event.data);
        if (finalizeRequestRef.current?.generation === generation && finalizeRequestRef.current.stage === "flushing") {
          finalizeRequestRef.current = null;
          sessionRef.current?.finalize();
          if (recorder.state === "paused") recorder.resume();
          if (queuedFinalizeRef.current) {
            queuedFinalizeRef.current = false;
            queueMicrotask(() => {
              if (generation !== generationRef.current || recorder.state !== "recording") return;
              finalizeRequestRef.current = { generation, stage: "pausing" };
              try {
                recorder.pause();
              } catch {
                finalizeRequestRef.current = null;
                sessionRef.current?.finalize();
              }
            });
          }
        }
      };
      recorder.onpause = () => {
        if (finalizeRequestRef.current?.generation !== generation || finalizeRequestRef.current.stage !== "pausing") return;
        finalizeRequestRef.current.stage = "flushing";
        try {
          recorder.requestData();
        } catch {
          finalizeRequestRef.current = null;
          sessionRef.current?.finalize();
          if (recorder.state === "paused") recorder.resume();
        }
      };
      recorder.onerror = () => failCurrent(generation, "오디오 입력을 읽을 수 없습니다.");
      recorder.onstop = () => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        recorderRef.current = null;
        transitionPhase("finishing");
        session.finish();
      };
      sourceStream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (generation !== generationRef.current) return;
          if (recorder.state !== "inactive") recorder.stop();
          stopTracks();
        }, { once: true });
      });
      recorder.start(250);
      transitionPhase("listening");
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      const message = caught instanceof DOMException && caught.name === "NotAllowedError"
        ? "마이크 또는 화면 공유 권한이 필요합니다."
        : caught instanceof Error
          ? caught.message
          : "실시간 세션을 시작할 수 없습니다.";
      failCurrent(generation, message);
    }
  }, [closeCurrent, failCurrent, stopTracks, transitionPhase]);

  const finalize = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    const recorder = recorderRef.current;
    if (!recorder) {
      sessionRef.current?.finalize();
      return;
    }
    if (finalizeRequestRef.current || recorder.state === "paused") {
      queuedFinalizeRef.current = true;
      return;
    }
    if (recorder.state !== "recording") return;
    finalizeRequestRef.current = { generation: generationRef.current, stage: "pausing" };
    try {
      recorder.pause();
    } catch {
      finalizeRequestRef.current = null;
      sessionRef.current?.finalize();
    }
  }, []);

  const pause = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording" || finalizeRequestRef.current) return;
    try {
      recorder.pause();
      transitionPhase("paused");
    } catch {
      // A recorder that refuses to pause simply keeps listening.
    }
  }, [transitionPhase]);

  const resume = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    try {
      recorder.resume();
      transitionPhase("listening");
    } catch {
      // Keep the truthful paused phase when the browser refuses to resume.
    }
  }, [transitionPhase]);

  const stop = useCallback(() => {
    if (phaseRef.current === "requesting" || phaseRef.current === "connecting") {
      generationRef.current += 1;
      closeCurrent();
      setError(null);
      transitionPhase("idle");
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.requestData?.();
    recorder.stop();
    stopTracks();
  }, [closeCurrent, stopTracks, transitionPhase]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    closeCurrent();
    setTranscript(emptySonioxTranscript());
    setError(null);
    transitionPhase("idle");
  }, [closeCurrent, transitionPhase]);

  return { phase, transcript, error, start, finalize, pause, resume, stop, reset };
}
