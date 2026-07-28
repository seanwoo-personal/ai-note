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

export interface SonioxTranscript {
  original: SonioxTextTrack;
  translation: SonioxTextTrack;
}

export function emptySonioxTranscript(): SonioxTranscript {
  return {
    original: { final: "", provisional: "" },
    translation: { final: "", provisional: "" },
  };
}

function tokenTrack(token: SonioxToken): keyof SonioxTranscript {
  return token.translation_status === "translation" ? "translation" : "original";
}

export function applySonioxResult(
  current: SonioxTranscript,
  result: SonioxResult,
): SonioxTranscript {
  const next: SonioxTranscript = {
    original: { final: current.original.final, provisional: "" },
    translation: { final: current.translation.final, provisional: "" },
  };
  for (const token of result.tokens ?? []) {
    if (!token.text || token.text === "<end>" || token.text === "<fin>") continue;
    const track = tokenTrack(token);
    if (token.is_final) next[track].final += token.text;
    else next[track].provisional += token.text;
  }
  return next;
}

export function buildSonioxConfig(
  temporaryApiKey: string,
  translation: SonioxTranslationOptions,
  languageHints: string[] = ["ko", "en"],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    api_key: temporaryApiKey,
    model: "stt-rt-v5",
    audio_format: "auto",
    language_hints: languageHints,
    enable_language_identification: true,
    enable_speaker_diarization: true,
    enable_endpoint_detection: true,
  };
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
  finish(): void;
  close(): void;
}

export interface ConnectSonioxRealtimeOptions {
  translation: SonioxTranslationOptions;
  languageHints?: string[];
  onTranscript: (transcript: SonioxTranscript) => void;
  onError?: (message: string) => void;
  onFinished?: () => void;
  signal?: AbortSignal;
}

const SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const CONNECT_TIMEOUT_MS = 10_000;

export async function connectSonioxRealtime(
  options: ConnectSonioxRealtimeOptions,
): Promise<SonioxRealtimeSession> {
  const fetchController = new AbortController();
  const abortFetch = () => fetchController.abort();
  options.signal?.addEventListener("abort", abortFetch, { once: true });
  if (options.signal?.aborted) abortFetch();
  const fetchTimeout = setTimeout(abortFetch, CONNECT_TIMEOUT_MS);
  let keyResponse: Response;
  let keyPayload: { apiKey?: unknown };
  try {
    keyResponse = await fetch("/api/soniox/temporary-key", {
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
  let finishTimeout: ReturnType<typeof setTimeout> | null = null;
  const clearFinishTimeout = () => {
    if (finishTimeout !== null) clearTimeout(finishTimeout);
    finishTimeout = null;
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
      socket.send(JSON.stringify(buildSonioxConfig(
        keyPayload.apiKey as string,
        options.translation,
        options.languageHints,
      )));
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
        options.onError?.(result.error_message || "실시간 전사 연결에 오류가 발생했습니다.");
        return;
      }
      transcript = applySonioxResult(transcript, result);
      options.onTranscript(transcript);
      if (result.finished) {
        clearFinishTimeout();
        options.onFinished?.();
      }
    } catch {
      options.onError?.("실시간 전사 응답을 확인할 수 없습니다.");
    }
  };
  socket.onerror = () => {
    if (!closing) options.onError?.("실시간 전사 연결에 오류가 발생했습니다.");
  };
  socket.onclose = () => {
    clearFinishTimeout();
    if (!closing) options.onError?.("실시간 전사 연결이 종료되었습니다.");
  };

  return {
    sendAudio(chunk) {
      if (socket.readyState === 1) socket.send(chunk);
    },
    finish() {
      if (socket.readyState !== 1) return;
      socket.send("");
      clearFinishTimeout();
      finishTimeout = setTimeout(() => {
        closing = true;
        socket.close();
        options.onError?.("Soniox 실시간 전사 완료 응답이 지연되어 연결을 종료했습니다.");
      }, CONNECT_TIMEOUT_MS);
    },
    close() {
      clearFinishTimeout();
      closing = true;
      socket.close();
    },
  };
}
