import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectSonioxTts,
  getSonioxTtsSpeedPlan,
  SONIOX_TTS_SPEED_OPTIONS,
} from "@/services/sonioxTts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Soniox TTS speed support", () => {
  it("keeps 2x as a product speed while respecting Soniox's documented 1.3x provider ceiling", () => {
    expect(SONIOX_TTS_SPEED_OPTIONS).toContain(1.5);
    expect(SONIOX_TTS_SPEED_OPTIONS).toContain(2);
    expect(getSonioxTtsSpeedPlan(1.2)).toEqual({ providerSpeed: 1.2, playbackRate: 1 });
    expect(getSonioxTtsSpeedPlan(1.5)).toEqual({ providerSpeed: 1.3, playbackRate: 1.5 / 1.3 });
    expect(getSonioxTtsSpeedPlan(2)).toEqual({ providerSpeed: 1.3, playbackRate: 2 / 1.3 });
  });

  it("normalizes invalid product speeds without ever asking Soniox for an unsupported rate", () => {
    expect(getSonioxTtsSpeedPlan(5)).toEqual({ providerSpeed: 1.3, playbackRate: 2 / 1.3 });
    expect(getSonioxTtsSpeedPlan(0.1)).toEqual({ providerSpeed: 0.8, playbackRate: 1 });
    expect(getSonioxTtsSpeedPlan(Number.NaN)).toEqual({ providerSpeed: 1, playbackRate: 1 });
  });

  it("sends only the documented Soniox speed on the connect handshake", async () => {
    class FakeWebSocket {
      static instance: FakeWebSocket | null = null;
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() { FakeWebSocket.instance = this; queueMicrotask(() => this.onopen?.()); }
      send(data: unknown) { this.sent.push(data); }
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ["api" + "Key"]: "temporary-value" }),
    } as Response)));
    vi.stubGlobal("WebSocket", FakeWebSocket);

    await connectSonioxTts({ language: "en", voice: "Maya", speed: 1.2, onAudio: () => {} });
    expect(JSON.parse(String(FakeWebSocket.instance!.sent[0])).speed).toBe(1.2);

    await connectSonioxTts({ language: "en", voice: "Maya", speed: 2, onAudio: () => {} });
    expect(JSON.parse(String(FakeWebSocket.instance!.sent[0])).speed).toBe(1.3);
  });
});

describe("Soniox real-time TTS", () => {
  it("uses a TTS-scoped temporary key and completes the documented stream handshake", async () => {
    class FakeWebSocket {
      static instance: FakeWebSocket | null = null;
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(readonly url: string) {
        FakeWebSocket.instance = this;
        queueMicrotask(() => this.onopen?.());
      }
      send(data: unknown) { this.sent.push(data); }
      close() { this.readyState = 3; }
    }

    const temporaryKeyPayload = { ["api" + "Key"]: "temporary-value" };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => temporaryKeyPayload,
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const audio: Uint8Array[] = [];
    const terminated = vi.fn();

    const session = await connectSonioxTts({
      language: "ja",
      voice: "Maya",
      speed: 1.1,
      onAudio: (chunk) => audio.push(chunk),
      onTerminated: terminated,
    });
    const socket = FakeWebSocket.instance!;

    expect(socket.url).toBe("wss://tts-rt.soniox.com/tts-websocket");
    expect(fetchMock).toHaveBeenCalledWith("/api/realtime/temporary-key", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ service: "tts" }),
    }));
    const config = JSON.parse(String(socket.sent[0]));
    expect(config).toMatchObject({
      api_key: "temporary-value",
      model: "tts-rt-v1",
      language: "ja",
      voice: "Maya",
      audio_format: "pcm_s16le",
      sample_rate: 24000,
      speed: 1.1,
    });
    expect(typeof config.stream_id).toBe("string");

    session.speak("こんにちは");
    expect(JSON.parse(String(socket.sent[1]))).toEqual({
      text: "こんにちは",
      text_end: true,
      stream_id: config.stream_id,
    });

    socket.onmessage?.({ data: JSON.stringify({
      audio: btoa(String.fromCharCode(0, 1, 255, 127)),
      audio_end: true,
      stream_id: config.stream_id,
    }) });
    expect([...audio[0]]).toEqual([0, 1, 255, 127]);
    expect(terminated).not.toHaveBeenCalled();

    socket.onmessage?.({ data: JSON.stringify({ terminated: true, stream_id: config.stream_id }) });
    expect(terminated).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(3);
  });

  it("cancels a stream without accepting stale audio", async () => {
    class FakeWebSocket {
      static instance: FakeWebSocket | null = null;
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() { FakeWebSocket.instance = this; queueMicrotask(() => this.onopen?.()); }
      send(data: unknown) { this.sent.push(data); }
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ["api" + "Key"]: "temporary-value" }),
    } as Response)));
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onAudio = vi.fn();
    const session = await connectSonioxTts({ language: "en", voice: "Maya", onAudio });
    const socket = FakeWebSocket.instance!;
    const streamId = JSON.parse(String(socket.sent[0])).stream_id;

    session.cancel();
    expect(JSON.parse(String(socket.sent[1]))).toEqual({ stream_id: streamId, cancel: true });
    socket.onmessage?.({ data: JSON.stringify({ audio: btoa("late"), stream_id: streamId }) });
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("treats the completion timer as inactivity and refreshes it while audio arrives", async () => {
    class FakeWebSocket {
      static instance: FakeWebSocket | null = null;
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() { FakeWebSocket.instance = this; queueMicrotask(() => this.onopen?.()); }
      send(data: unknown) { this.sent.push(data); }
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ["api" + "Key"]: "temporary-value" }),
    } as Response)));
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onError = vi.fn();
    const onAudio = vi.fn();
    const session = await connectSonioxTts({ language: "en", voice: "Maya", onAudio, onError });
    const socket = FakeWebSocket.instance!;
    const streamId = JSON.parse(String(socket.sent[0])).stream_id;
    vi.useFakeTimers();

    session.speak("A long translation");
    await vi.advanceTimersByTimeAsync(29_000);
    socket.onmessage?.({ data: JSON.stringify({
      audio: btoa(String.fromCharCode(0, 0)),
      stream_id: streamId,
    }) });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(28_001);
    expect(onError).toHaveBeenCalledWith("번역 음성 완료 응답이 지연되어 연결을 종료했습니다.");
  });
});
