const SONIOX_TTS_WEBSOCKET_URL = "wss://tts-rt.soniox.com/tts-websocket";
const CONNECT_TIMEOUT_MS = 10_000;
const TERMINATION_TIMEOUT_MS = 30_000;

interface SonioxTtsResponse {
  stream_id?: unknown;
  audio?: unknown;
  audio_end?: unknown;
  terminated?: unknown;
  error_code?: unknown;
  error_message?: unknown;
}

export interface ConnectSonioxTtsOptions {
  language: string;
  voice: string;
  speed?: number;
  onAudio: (chunk: Uint8Array) => void;
  onAudioEnd?: () => void;
  onTerminated?: () => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export interface SonioxTtsSession {
  speak(text: string): void;
  cancel(): void;
  close(): void;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createStreamId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tts-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function connectSonioxTts(
  options: ConnectSonioxTtsOptions,
): Promise<SonioxTtsSession> {
  const fetchController = new AbortController();
  const abortFetch = () => fetchController.abort();
  options.signal?.addEventListener("abort", abortFetch, { once: true });
  if (options.signal?.aborted) abortFetch();
  const fetchTimeout = setTimeout(abortFetch, CONNECT_TIMEOUT_MS);
  let keyPayload: { apiKey?: unknown };
  try {
    const response = await fetch("/api/soniox/temporary-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "tts" }),
      cache: "no-store",
      signal: fetchController.signal,
    });
    if (!response.ok) throw new Error("soniox_tts_temporary_key_unavailable");
    keyPayload = await response.json() as { apiKey?: unknown };
  } finally {
    clearTimeout(fetchTimeout);
    options.signal?.removeEventListener("abort", abortFetch);
  }
  if (typeof keyPayload.apiKey !== "string" || !keyPayload.apiKey) {
    throw new Error("soniox_tts_temporary_key_invalid");
  }

  const socket = new WebSocket(SONIOX_TTS_WEBSOCKET_URL);
  const streamId = createStreamId();
  let closed = false;
  let cancelled = false;
  let terminationTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearTerminationTimeout = () => {
    if (terminationTimeout !== null) clearTimeout(terminationTimeout);
    terminationTimeout = null;
  };
  const detachRuntimeHandlers = () => {
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  };
  const closeSilently = () => {
    if (closed) return;
    closed = true;
    clearTerminationTimeout();
    detachRuntimeHandlers();
    socket.close();
  };
  const failRuntime = (message: string, closeSocket = true) => {
    if (closed || cancelled) return;
    closed = true;
    clearTerminationTimeout();
    detachRuntimeHandlers();
    if (closeSocket) socket.close();
    options.onError?.(message);
  };
  const armInactivityTimeout = () => {
    clearTerminationTimeout();
    terminationTimeout = setTimeout(() => {
      failRuntime("번역 음성 완료 응답이 지연되어 연결을 종료했습니다.");
    }, TERMINATION_TIMEOUT_MS);
  };

  await new Promise<void>((resolve, reject) => {
    const fail = (code: string) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortSocket);
      closed = true;
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      reject(new Error(code));
    };
    const abortSocket = () => fail("soniox_tts_websocket_aborted");
    const timeout = setTimeout(() => fail("soniox_tts_websocket_timeout"), CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortSocket);
      socket.send(JSON.stringify({
        api_key: keyPayload.apiKey,
        model: "tts-rt-v1",
        language: options.language,
        voice: options.voice,
        audio_format: "pcm_s16le",
        sample_rate: 24_000,
        speed: options.speed ?? 1,
        stream_id: streamId,
      }));
      resolve();
    };
    socket.onerror = () => fail("soniox_tts_websocket_unavailable");
    socket.onclose = () => fail("soniox_tts_websocket_closed");
    options.signal?.addEventListener("abort", abortSocket, { once: true });
    if (options.signal?.aborted) abortSocket();
  });

  socket.onmessage = (event) => {
    if (closed || cancelled) return;
    try {
      const result = JSON.parse(String(event.data)) as SonioxTtsResponse;
      if (result.stream_id !== streamId) return;
      if (typeof result.error_code === "number") {
        failRuntime(
          typeof result.error_message === "string" && result.error_message
            ? result.error_message
            : "번역 음성을 만들 수 없습니다.",
        );
        return;
      }
      if (typeof result.audio === "string" && result.audio) {
        armInactivityTimeout();
        options.onAudio(decodeBase64(result.audio));
      }
      if (result.audio_end === true) options.onAudioEnd?.();
      if (result.terminated === true) {
        options.onTerminated?.();
        closeSilently();
      }
    } catch {
      failRuntime("번역 음성 응답을 확인할 수 없습니다.");
    }
  };
  socket.onerror = () => failRuntime("번역 음성 연결에 오류가 발생했습니다.");
  socket.onclose = () => failRuntime("번역 음성 연결이 종료되었습니다.", false);

  return {
    speak(text) {
      if (closed || cancelled || socket.readyState !== 1) return;
      const normalized = text.trim();
      if (!normalized) return;
      socket.send(JSON.stringify({ text: normalized, text_end: true, stream_id: streamId }));
      armInactivityTimeout();
    },
    cancel() {
      if (closed || cancelled) return;
      cancelled = true;
      clearTerminationTimeout();
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ stream_id: streamId, cancel: true }));
      }
      detachRuntimeHandlers();
      socket.close();
      closed = true;
    },
    close: closeSilently,
  };
}
