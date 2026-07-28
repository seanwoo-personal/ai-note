// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";

const soniox = vi.hoisted(() => ({
  connect: vi.fn(),
  sendAudio: vi.fn(),
  finish: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/services/sonioxRealtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/sonioxRealtime")>();
  return { ...actual, connectSonioxRealtime: soniox.connect };
});

class FakeTrack {
  stop = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  constructor(readonly kind: "audio" | "video" = "audio") {}
}

class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
}

class FakeMediaRecorder {
  static instance: FakeMediaRecorder | null = null;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn((timeslice?: number) => {
    this.state = "recording";
    expect(timeslice).toBe(250);
  });
  requestData = vi.fn();
  stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });
  constructor(readonly stream: FakeMediaStream) { FakeMediaRecorder.instance = this; }
}

const START_OPTIONS = {
  inputSource: "microphone" as const,
  translation: { mode: "one_way" as const, targetLanguage: "ja" },
};

function installMediaDevices(values: {
  getUserMedia?: () => Promise<MediaStream>;
  getDisplayMedia?: () => Promise<MediaStream>;
}) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: values,
  });
}

function connectCallbacks() {
  return soniox.connect.mock.calls[0]?.[0] as {
    onTranscript(transcript: {
      original: { final: string; provisional: string };
      translation: { final: string; provisional: string };
    }): void;
    onError(message: string): void;
    onFinished(): void;
  };
}

describe("useSonioxLiveCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeMediaRecorder.instance = null;
    soniox.connect.mockResolvedValue({
      sendAudio: soniox.sendAudio,
      finish: soniox.finish,
      close: soniox.close,
    });
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  it("streams microphone chunks and releases every resource when stopped", async () => {
    const audioTrack = new FakeTrack();
    const stream = new FakeMediaStream([audioTrack]) as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    installMediaDevices({ getUserMedia });

    const { result, unmount } = renderHook(() => useSonioxLiveCapture());
    await act(async () => { await result.current.start(START_OPTIONS); });

    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({ echoCancellation: true }),
    }));
    expect(soniox.connect).toHaveBeenCalledWith(expect.objectContaining({
      translation: START_OPTIONS.translation,
      languageHints: ["ko", "en", "ja", "zh"],
    }));
    expect(result.current.phase).toBe("listening");

    const chunk = new Blob(["audio"], { type: "audio/webm" });
    act(() => FakeMediaRecorder.instance?.ondataavailable?.({ data: chunk }));
    expect(soniox.sendAudio).toHaveBeenCalledWith(chunk);

    act(() => result.current.stop());
    await waitFor(() => expect(soniox.finish).toHaveBeenCalledTimes(1));
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("remains mounted through the Strict Mode setup-cleanup-setup cycle", async () => {
    const track = new FakeTrack();
    installMediaDevices({ getUserMedia: async () => new FakeMediaStream([track]) as unknown as MediaStream });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useSonioxLiveCapture(), { wrapper });

    await act(async () => { await result.current.start(START_OPTIONS); });

    expect(result.current.phase).toBe("listening");
    expect(soniox.connect).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("records only display audio while stopping every original display track", async () => {
    const audioTrack = new FakeTrack("audio");
    const videoTrack = new FakeTrack("video");
    const displayStream = new FakeMediaStream([audioTrack, videoTrack]) as unknown as MediaStream;
    const getDisplayMedia = vi.fn(async () => displayStream);
    installMediaDevices({ getDisplayMedia });

    const { result } = renderHook(() => useSonioxLiveCapture());
    await act(async () => {
      await result.current.start({ ...START_OPTIONS, inputSource: "browser-tab" });
    });

    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(FakeMediaRecorder.instance?.stream.getTracks()).toEqual([audioTrack]);
    expect(FakeMediaRecorder.instance?.stream.getTracks()).not.toContain(videoTrack);

    act(() => result.current.stop());
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("terminates recorder, session, and tracks on a Soniox error without overwriting error phase", async () => {
    const track = new FakeTrack();
    installMediaDevices({ getUserMedia: async () => new FakeMediaStream([track]) as unknown as MediaStream });
    const { result } = renderHook(() => useSonioxLiveCapture());
    await act(async () => { await result.current.start(START_OPTIONS); });
    const recorder = FakeMediaRecorder.instance!;

    act(() => connectCallbacks().onError("연결이 끊겼습니다."));

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("연결이 끊겼습니다.");
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(recorder.onstop).toBeNull();
    expect(soniox.close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    act(() => recorder.onstop?.());
    expect(result.current.phase).toBe("error");
  });

  it("intentionally closes the session and tracks after Soniox reports finished", async () => {
    const track = new FakeTrack();
    installMediaDevices({ getUserMedia: async () => new FakeMediaStream([track]) as unknown as MediaStream });
    const { result } = renderHook(() => useSonioxLiveCapture());
    await act(async () => { await result.current.start(START_OPTIONS); });
    const callbacks = connectCallbacks();
    const staleOnstop = FakeMediaRecorder.instance?.onstop;

    act(() => callbacks.onFinished());

    expect(result.current.phase).toBe("finished");
    expect(soniox.close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);

    act(() => {
      callbacks.onTranscript({
        original: { final: "늦은 결과", provisional: "" },
        translation: { final: "late result", provisional: "" },
      });
      callbacks.onError("늦은 오류");
      staleOnstop?.();
    });
    expect(result.current.phase).toBe("finished");
    expect(result.current.error).toBeNull();
    expect(result.current.transcript.original.final).toBe("");
    expect(soniox.finish).not.toHaveBeenCalled();
  });

  it("keeps a MediaRecorder error terminal instead of running its stale onstop finish path", async () => {
    const track = new FakeTrack();
    installMediaDevices({ getUserMedia: async () => new FakeMediaStream([track]) as unknown as MediaStream });
    const { result } = renderHook(() => useSonioxLiveCapture());
    await act(async () => { await result.current.start(START_OPTIONS); });
    const recorder = FakeMediaRecorder.instance!;

    act(() => recorder.onerror?.());

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("오디오 입력을 읽을 수 없습니다.");
    expect(recorder.onstop).toBeNull();
    expect(soniox.finish).not.toHaveBeenCalled();
    expect(soniox.close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending permission request and rejects its stale stream", async () => {
    const track = new FakeTrack();
    const stream = new FakeMediaStream([track]) as unknown as MediaStream;
    let resolveStream!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    installMediaDevices({ getUserMedia: () => pending });
    const { result } = renderHook(() => useSonioxLiveCapture());

    let startPromise!: Promise<void>;
    act(() => { startPromise = result.current.start(START_OPTIONS); });
    await waitFor(() => expect(result.current.phase).toBe("requesting"));
    act(() => result.current.stop());
    expect(result.current.phase).toBe("idle");
    await act(async () => { resolveStream(stream); await startPromise; });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(soniox.connect).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });
});
