import { describe, expect, it, vi } from "vitest";

import {
  applySonioxResult,
  buildSonioxConfig,
  connectSonioxRealtime,
  emptySonioxTranscript,
} from "@/services/sonioxRealtime";

describe("Soniox real-time transcript", () => {
  it("appends final tokens, replaces provisional tokens, and separates translations", () => {
    const first = applySonioxResult(emptySonioxTranscript(), {
      tokens: [
        { text: "안녕", is_final: true, language: "ko", translation_status: "original" },
        { text: "하세요", is_final: false, language: "ko", translation_status: "original" },
        { text: "Hello", is_final: true, language: "en", source_language: "ko", translation_status: "translation" },
        { text: " there", is_final: false, language: "en", source_language: "ko", translation_status: "translation" },
      ],
    });

    expect(first.original).toEqual({ final: "안녕", provisional: "하세요" });
    expect(first.translation).toEqual({ final: "Hello", provisional: " there" });

    const second = applySonioxResult(first, {
      tokens: [
        { text: "하세요", is_final: true, language: "ko", translation_status: "original" },
        { text: "<end>", is_final: true, language: "ko", translation_status: "original" },
        { text: "!", is_final: false, language: "ko", translation_status: "original" },
        { text: " there", is_final: true, language: "en", source_language: "ko", translation_status: "translation" },
        { text: "!", is_final: false, language: "en", source_language: "ko", translation_status: "translation" },
      ],
    });

    expect(second.original).toEqual({ final: "안녕하세요", provisional: "!" });
    expect(second.translation).toEqual({ final: "Hello there", provisional: "!" });
  });

  it("builds one-way and two-way translation configurations without exposing long-lived keys", () => {
    expect(buildSonioxConfig("temporary-key", {
      mode: "one_way",
      targetLanguage: "en",
    })).toMatchObject({
      api_key: "temporary-key",
      model: "stt-rt-v5",
      audio_format: "auto",
      language_hints: ["ko", "en"],
      enable_language_identification: true,
      enable_speaker_diarization: true,
      enable_endpoint_detection: true,
      translation: { type: "one_way", target_language: "en" },
    });

    expect(buildSonioxConfig("temporary-key", {
      mode: "two_way",
      languageA: "ko",
      languageB: "en",
    }).translation).toEqual({ type: "two_way", language_a: "ko", language_b: "en" });
  });

  it("connects with a temporary key, streams WebM chunks, and ends with an empty frame", async () => {
    class FakeWebSocket {
      static instance: FakeWebSocket | null = null;
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      binaryType = "";
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(readonly url: string) {
        FakeWebSocket.instance = this;
        queueMicrotask(() => this.onopen?.());
      }

      send(data: unknown) {
        this.sent.push(data);
      }

      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ apiKey: "temporary-key" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const updates: string[] = [];
    const errors: string[] = [];

    const session = await connectSonioxRealtime({
      translation: { mode: "one_way", targetLanguage: "en" },
      onTranscript: (transcript) => updates.push(
        transcript.original.final + transcript.original.provisional,
      ),
      onError: (message) => errors.push(message),
    });
    const socket = FakeWebSocket.instance!;
    expect(socket.url).toBe("wss://stt-rt.soniox.com/transcribe-websocket");
    expect(fetchMock).toHaveBeenCalledWith("/api/soniox/temporary-key", expect.objectContaining({
      method: "POST",
    }));
    expect(JSON.parse(String(socket.sent[0]))).toMatchObject({
      api_key: "temporary-key",
      audio_format: "auto",
      translation: { type: "one_way", target_language: "en" },
    });

    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    session.sendAudio(audio);
    expect(socket.sent[1]).toBe(audio);

    socket.onmessage?.({ data: JSON.stringify({
      tokens: [{ text: "안녕", is_final: false, translation_status: "original" }],
    }) });
    expect(updates).toEqual(["안녕"]);

    vi.useFakeTimers();
    session.finish();
    expect(socket.sent[2]).toBe("");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.readyState).toBe(3);
    expect(errors).toEqual(["Soniox 실시간 전사 완료 응답이 지연되어 연결을 종료했습니다."]);
    vi.useRealTimers();
  });

  it("rejects and closes a socket that closes before opening", async () => {
    class ClosingWebSocket {
      static instance: ClosingWebSocket | null = null;
      readyState = 0;
      binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() { ClosingWebSocket.instance = this; }
      send() {}
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ apiKey: "temporary-key" }),
      { status: 200 },
    )));
    vi.stubGlobal("WebSocket", ClosingWebSocket);

    const connecting = connectSonioxRealtime({
      translation: { mode: "none" },
      onTranscript: () => {},
    });
    await vi.waitFor(() => expect(ClosingWebSocket.instance).not.toBeNull());
    ClosingWebSocket.instance!.onclose?.();
    await expect(connecting).rejects.toThrow("soniox_websocket_closed");
    expect(ClosingWebSocket.instance!.readyState).toBe(3);
  });

  it("aborts a stalled temporary-key response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    } as Response)));

    const connecting = connectSonioxRealtime({
      translation: { mode: "none" },
      onTranscript: () => {},
    });
    const rejection = expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    vi.useRealTimers();
  });
});
