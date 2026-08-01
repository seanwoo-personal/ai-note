import {
  sonioxConnectionStore,
  type SonioxSessionPublisher,
} from "@/services/sonioxConnectionStore";

export type SonioxTranslationOptions =
  | { mode: "none" }
  | { mode: "one_way"; targetLanguage: string }
  | { mode: "two_way"; languageA: string; languageB: string };

export interface SonioxToken {
  text: string;
  is_final: boolean;
  language?: string;
  source_language?: string;
  speaker?: string;
  translation_status?: "none" | "original" | "translation";
}

export interface SonioxResult {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
}

export interface SonioxTextTrack {
  final: string;
  provisional: string;
}

export interface SonioxSpeakerTrack {
  original: SonioxTextTrack;
  translation: SonioxTextTrack;
  originalLanguage?: string;
  translationLanguage?: string;
  /**
   * Character counts of final original tokens by language within the current
   * utterance (reset at each endpoint). Used to classify the dominant source
   * language and detect intra-utterance code-switching.
   */
  segmentOriginalLanguages?: Record<string, number>;
}

export interface SonioxEndpointEvent {
  id: number;
  kind?: "end" | "fin";
  speaker: string | null;
  originalLanguage?: string;
  /** True when this utterance's original tokens span more than one language. */
  codeSwitched?: boolean;
  originalFinal: string;
  translationFinal: string;
}

export interface SonioxTranscript {
  original: SonioxTextTrack;
  translation: SonioxTextTrack;
  speakers: Record<string, SonioxSpeakerTrack>;
  activeSpeaker: string | null;
  endpointCount: number;
  lastEndpointSpeaker: string | null;
  endpoints?: SonioxEndpointEvent[];
  /** Global (no-speaker) per-utterance original-language char counts, reset at each endpoint. */
  segmentOriginalLanguages?: Record<string, number>;
}

export function emptySonioxTranscript(): SonioxTranscript {
  return {
    original: { final: "", provisional: "" },
    translation: { final: "", provisional: "" },
    speakers: {},
    activeSpeaker: null,
    endpointCount: 0,
    lastEndpointSpeaker: null,
    endpoints: [],
    segmentOriginalLanguages: {},
  };
}

function tokenTrack(token: SonioxToken): "original" | "translation" {
  return token.translation_status === "translation" ? "translation" : "original";
}

function dominantLanguage(counts: Record<string, number> | undefined): string | undefined {
  if (!counts) return undefined;
  let best: string | undefined;
  let bestCount = 0;
  for (const [language, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }
  return best;
}

function isCodeSwitched(counts: Record<string, number> | undefined): boolean {
  if (!counts) return false;
  return Object.values(counts).filter((count) => count > 0).length > 1;
}

export function applySonioxResult(
  current: SonioxTranscript,
  result: SonioxResult,
): SonioxTranscript {
  const next: SonioxTranscript = {
    original: { final: current.original.final, provisional: "" },
    translation: { final: current.translation.final, provisional: "" },
    speakers: Object.fromEntries(Object.entries(current.speakers).map(([speaker, track]) => [speaker, {
      ...track,
      original: { final: track.original.final, provisional: "" },
      translation: { final: track.translation.final, provisional: "" },
    }])),
    activeSpeaker: current.activeSpeaker,
    endpointCount: current.endpointCount,
    lastEndpointSpeaker: current.lastEndpointSpeaker,
    endpoints: current.endpoints ?? [],
    segmentOriginalLanguages: { ...(current.segmentOriginalLanguages ?? {}) },
  };
  for (const token of result.tokens ?? []) {
    if (!token.text) continue;
    if (token.text === "<end>" || token.text === "<fin>") {
      next.endpointCount += 1;
      const speaker = token.speaker ?? next.activeSpeaker;
      next.lastEndpointSpeaker = speaker;
      const speakerTrack = speaker ? next.speakers[speaker] : undefined;
      const segmentCounts = speakerTrack?.segmentOriginalLanguages ?? next.segmentOriginalLanguages;
      next.endpoints = [
        ...(next.endpoints ?? []).slice(-99),
        {
          id: next.endpointCount,
          kind: token.text === "<fin>" ? "fin" : "end",
          speaker,
          originalLanguage: speakerTrack?.originalLanguage ?? dominantLanguage(next.segmentOriginalLanguages),
          codeSwitched: isCodeSwitched(segmentCounts),
          originalFinal: speakerTrack?.original.final ?? next.original.final,
          translationFinal: speakerTrack?.translation.final ?? next.translation.final,
        },
      ];
      // Reset per-utterance language accounting so the next utterance is classified fresh.
      if (speakerTrack) speakerTrack.segmentOriginalLanguages = {};
      next.segmentOriginalLanguages = {};
      continue;
    }

    const track = tokenTrack(token);
    if (token.is_final) next[track].final += token.text;
    else next[track].provisional += token.text;
    if (track === "original" && token.is_final && token.language) {
      next.segmentOriginalLanguages = {
        ...next.segmentOriginalLanguages,
        [token.language]: (next.segmentOriginalLanguages?.[token.language] ?? 0) + token.text.length,
      };
    }
    if (track === "original" && token.speaker) next.activeSpeaker = token.speaker;
    const speaker = token.speaker ?? next.activeSpeaker;
    if (!speaker) continue;
    const speakerTrack = next.speakers[speaker] ?? {
      original: { final: "", provisional: "" },
      translation: { final: "", provisional: "" },
    };
    if (token.is_final) speakerTrack[track].final += token.text;
    else speakerTrack[track].provisional += token.text;
    if (track === "original" && token.language) {
      if (token.is_final) {
        speakerTrack.segmentOriginalLanguages = {
          ...speakerTrack.segmentOriginalLanguages,
          [token.language]: (speakerTrack.segmentOriginalLanguages?.[token.language] ?? 0) + token.text.length,
        };
      }
      speakerTrack.originalLanguage = dominantLanguage(speakerTrack.segmentOriginalLanguages) ?? token.language;
    }
    if (track === "translation" && token.language) speakerTrack.translationLanguage = token.language;
    next.speakers[speaker] = speakerTrack;
  }
  return next;
}

export interface SonioxContext {
  general?: Array<{ key: string; value: string }>;
  terms?: string[];
}

export function buildSonioxConfig(
  sessionKey: string,
  translation: SonioxTranslationOptions,
  languageHints: string[] = ["ko", "en"],
  context?: SonioxContext,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    api_key: sessionKey,
    model: "stt-rt-v5",
    audio_format: "auto",
    language_hints: languageHints,
    enable_language_identification: true,
    enable_speaker_diarization: true,
    enable_endpoint_detection: true,
  };
  if (context && (context.general?.length || context.terms?.length)) {
    config.context = context;
  }
  if (translation.mode === "one_way") {
    config.translation = {
      type: "one_way",
      target_language: translation.targetLanguage,
    };
  } else if (translation.mode === "two_way") {
    config.translation = {
      type: "two_way",
      language_a: translation.languageA,
      language_b: translation.languageB,
    };
  }
  return config;
}

export interface SonioxRealtimeSession {
  sendAudio(chunk: Blob): void;
  finalize(): void;
  finish(): void;
  close(): void;
}

export interface ConnectSonioxRealtimeOptions {
  translation: SonioxTranslationOptions;
  languageHints?: string[];
  context?: SonioxContext;
  onTranscript: (transcript: SonioxTranscript) => void;
  onError?: (message: string) => void;
  onFinished?: () => void;
  signal?: AbortSignal;
  /**
   * Authoritative connection publisher for this attempt. Defaults to a fresh
   * session on the app-wide singleton store. Injectable for deterministic tests.
   */
  connection?: SonioxSessionPublisher;
}

const SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const CONNECT_TIMEOUT_MS = 10_000;

export async function connectSonioxRealtime(
  options: ConnectSonioxRealtimeOptions,
): Promise<SonioxRealtimeSession> {
  // Publish authoritative lifecycle to the connection store. beginSession()
  // already emits an optimistic "connecting"; any failure before we return a
  // live session must land on "disconnected" so no stale "connected" survives.
  const connection = options.connection ?? sonioxConnectionStore.beginSession();
  try {
    return await establishSonioxRealtime(options, connection);
  } catch (error) {
    connection.disconnected();
    throw error;
  }
}

async function establishSonioxRealtime(
  options: ConnectSonioxRealtimeOptions,
  connection: SonioxSessionPublisher,
): Promise<SonioxRealtimeSession> {
  const fetchController = new AbortController();
  const abortFetch = () => fetchController.abort();
  options.signal?.addEventListener("abort", abortFetch, { once: true });
  if (options.signal?.aborted) abortFetch();
  const fetchTimeout = setTimeout(abortFetch, CONNECT_TIMEOUT_MS);
  let keyResponse: Response;
  let keyPayload: { apiKey?: unknown };
  try {
    keyResponse = await fetch("/api/realtime/temporary-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: fetchController.signal,
    });
    if (!keyResponse.ok) throw new Error("soniox_temporary_key_unavailable");
    keyPayload = await keyResponse.json() as { apiKey?: unknown };
  } finally {
    clearTimeout(fetchTimeout);
    options.signal?.removeEventListener("abort", abortFetch);
  }
  if (typeof keyPayload.apiKey !== "string" || !keyPayload.apiKey) {
    throw new Error("soniox_temporary_key_invalid");
  }

  const socket = new WebSocket(SONIOX_WEBSOCKET_URL);
  socket.binaryType = "arraybuffer";
  let transcript = emptySonioxTranscript();
  let closing = false;
  // Set once the provider sends its terminal response. The socket close that
  // follows is the normal end of a finished stream, not a failure.
  let finished = false;
  let finishTimeout: ReturnType<typeof setTimeout> | null = null;
  const clearFinishTimeout = () => {
    if (finishTimeout !== null) clearTimeout(finishTimeout);
    finishTimeout = null;
  };
  const detachRuntimeHandlers = () => {
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  };
  // Clean teardown for the live phase (explicit close or a post-connect abort):
  // no onError, just disconnect + close. Shared by close() and runtimeAbort().
  const closeRuntime = () => {
    if (closing) return;
    closing = true;
    clearFinishTimeout();
    detachRuntimeHandlers();
    options.signal?.removeEventListener("abort", runtimeAbort);
    connection.disconnected();
    socket.close();
  };
  // A function declaration, not a const: `closeRuntime` and `failRuntimeSession`
  // both need this listener reference to detach it, and hoisting keeps that
  // mutual reference safe regardless of how the teardown helpers are ordered.
  function runtimeAbort() {
    closeRuntime();
  }
  const failRuntimeSession = (message: string, closeSocket = true) => {
    if (closing) return;
    closing = true;
    clearFinishTimeout();
    detachRuntimeHandlers();
    options.signal?.removeEventListener("abort", runtimeAbort);
    // Publish disconnected BEFORE closing the socket / notifying the caller, so a
    // detached onclose handler can never leave the store on a stale "connected".
    connection.disconnected();
    if (closeSocket) socket.close();
    options.onError?.(message);
  };
  await new Promise<void>((resolve, reject) => {
    const fail = (code: string) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortSocket);
      closing = true;
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      reject(new Error(code));
    };
    const abortSocket = () => fail("soniox_websocket_aborted");
    const timeout = setTimeout(() => fail("soniox_websocket_timeout"), CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortSocket);
      try {
        socket.send(JSON.stringify(buildSonioxConfig(
          keyPayload.apiKey as string,
          options.translation,
          options.languageHints,
          options.context,
        )));
      } catch {
        // The socket opened but rejected the config frame — never reach a stale
        // "connected"; fail the connect so the outer catch marks disconnected.
        fail("soniox_websocket_unavailable");
        return;
      }
      // Authoritative "connected": WebSocket open AND config sent.
      connection.connected();
      resolve();
    };
    socket.onerror = () => fail("soniox_websocket_unavailable");
    socket.onclose = () => fail("soniox_websocket_closed");
    options.signal?.addEventListener("abort", abortSocket, { once: true });
    if (options.signal?.aborted) abortSocket();
  });

  socket.onmessage = (event) => {
    try {
      const result = JSON.parse(String(event.data)) as SonioxResult;
      if (typeof result.error_code === "number") {
        // Never surface the provider's raw error text (it can carry the vendor
        // name or account details) — map to a generic local message + code.
        failRuntimeSession(`실시간 전사 연결에 오류가 발생했습니다. (코드 ${result.error_code})`);
        return;
      }
      transcript = applySonioxResult(transcript, result);
      options.onTranscript(transcript);
      if (result.finished) {
        // Provider terminal response is the authoritative disconnect boundary
        // for finish(): end-of-input alone did not disconnect us. Handlers stay
        // attached so the socket close that follows tears down cleanly instead
        // of leaking, but it must no longer be reported as a failure.
        finished = true;
        clearFinishTimeout();
        connection.disconnected();
        options.onFinished?.();
      }
    } catch {
      failRuntimeSession("실시간 전사 응답을 확인할 수 없습니다.");
    }
  };
  socket.onerror = () => {
    if (finished) return;
    failRuntimeSession("실시간 전사 연결에 오류가 발생했습니다.");
  };
  socket.onclose = () => {
    // Expected teardown after the provider finished the stream — tear down
    // quietly rather than surfacing "연결이 종료되었습니다" for a clean finish.
    if (finished) {
      closeRuntime();
      return;
    }
    failRuntimeSession("실시간 전사 연결이 종료되었습니다.", false);
  };

  // After the session is live, an abort must still tear down the real socket and
  // drop the store to disconnected — the connect-phase abort listener was already
  // removed on open, so without this a post-connect abort would leave it stale.
  options.signal?.addEventListener("abort", runtimeAbort, { once: true });
  if (options.signal?.aborted) runtimeAbort();

  return {
    sendAudio(chunk) {
      if (socket.readyState === 1) socket.send(chunk);
    },
    finalize() {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "finalize" }));
    },
    finish() {
      if (socket.readyState !== 1) return;
      socket.send("");
      clearFinishTimeout();
      finishTimeout = setTimeout(() => {
        failRuntimeSession("실시간 전사 완료 응답이 지연되어 연결을 종료했습니다.");
      }, CONNECT_TIMEOUT_MS);
    },
    close() {
      // Emit disconnected before detaching from the socket so the store is
      // updated even though our onclose handler is now removed.
      closeRuntime();
    },
  };
}
