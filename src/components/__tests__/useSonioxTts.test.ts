// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSonioxTts } from "@/components/useSonioxTts";

const soniox = vi.hoisted(() => ({
  connect: vi.fn(),
  speak: vi.fn(),
  cancel: vi.fn(),
  close: vi.fn(),
  callbacks: null as null | {
    onAudio(chunk: Uint8Array): void;
    onTerminated(): void;
    onError(message: string): void;
  },
}));

vi.mock("@/services/sonioxTts", () => ({
  connectSonioxTts: soniox.connect,
}));

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static instance: FakeAudioContext | null = null;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  sources: FakeSource[] = [];
  channelData: Float32Array[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() { FakeAudioContext.instance = this; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    this.channelData.push(data);
    return { duration: length / sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

describe("useSonioxTts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeAudioContext.instance = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    soniox.connect.mockImplementation(async (callbacks) => {
      soniox.callbacks = callbacks;
      return { speak: soniox.speak, cancel: soniox.cancel, close: soniox.close };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("queues little-endian PCM audio and finishes only after scheduled playback", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSonioxTts());

    await act(async () => {
      await result.current.speak({ text: "Hello", language: "en", voice: "Maya", speed: 1 });
    });
    expect(soniox.connect).toHaveBeenCalledWith(expect.objectContaining({
      language: "en",
      voice: "Maya",
      speed: 1,
    }));
    expect(soniox.speak).toHaveBeenCalledWith("Hello");
    expect(result.current.phase).toBe("connecting");

    act(() => soniox.callbacks?.onAudio(new Uint8Array([0, 0, 255, 127])));
    const context = FakeAudioContext.instance!;
    expect(result.current.phase).toBe("playing");
    expect(context.channelData[0][0]).toBe(0);
    expect(context.channelData[0][1]).toBeCloseTo(32767 / 32768);
    expect(context.sources[0].start).toHaveBeenCalledWith(expect.any(Number));

    act(() => soniox.callbacks?.onTerminated());
    expect(result.current.phase).toBe("playing");
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(result.current.phase).toBe("finished");
  });

  it("preconnects the matching Soniox stream so speak skips the network handshake", async () => {
    const { result } = renderHook(() => useSonioxTts());
    const options = { language: "ja", voice: "Maya", speed: 1 };

    await act(async () => { await result.current.prepare(options); });

    expect(soniox.connect).toHaveBeenCalledTimes(1);
    expect(soniox.speak).not.toHaveBeenCalled();

    await act(async () => { await result.current.speak({ ...options, text: "こんにちは" }); });

    expect(soniox.connect).toHaveBeenCalledTimes(1);
    expect(soniox.speak).toHaveBeenCalledWith("こんにちは");
  });

  it("refreshes an unused warm session before Soniox's first-stream timeout", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSonioxTts());
    const options = { language: "ja", voice: "Maya", speed: 1 };

    await act(async () => { await result.current.prepare(options); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });

    expect(soniox.connect).toHaveBeenCalledTimes(3);
    expect(soniox.close).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.speak({ ...options, text: "こんにちは" }); });
    expect(soniox.connect).toHaveBeenCalledTimes(3);
    expect(soniox.speak).toHaveBeenCalledWith("こんにちは");
  });

  it("silently aborts an in-flight warm refresh when speech starts", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSonioxTts());
    const options = { language: "ja", voice: "Maya", speed: 1 };
    await act(async () => { await result.current.prepare(options); });
    soniox.connect.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await result.current.speak({ ...options, text: "こんにちは" }); });

    expect(soniox.connect).toHaveBeenCalledTimes(2);
    expect(soniox.speak).toHaveBeenCalledWith("こんにちは");
    expect(result.current.error).toBeNull();
  });

  it("does not resurrect prepare after stop while AudioContext resume is pending", async () => {
    let resumeContext!: () => void;
    class SuspendedAudioContext extends FakeAudioContext {
      state: AudioContextState = "suspended";
      resume = vi.fn(() => new Promise<void>((resolve) => {
        resumeContext = () => { this.state = "running"; resolve(); };
      }));
    }
    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    Object.defineProperty(window, "AudioContext", { configurable: true, value: SuspendedAudioContext });
    const { result } = renderHook(() => useSonioxTts());
    let pending!: Promise<void>;

    act(() => { pending = result.current.prepare({ language: "ja", voice: "Maya", speed: 1 }); });
    await waitFor(() => expect(SuspendedAudioContext.instance?.resume).toHaveBeenCalledTimes(1));
    act(() => result.current.stop());
    resumeContext();
    await act(async () => { await pending; });

    expect(soniox.connect).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("does not resurrect speak after stop while AudioContext resume is pending", async () => {
    let resumeContext!: () => void;
    class SuspendedAudioContext extends FakeAudioContext {
      state: AudioContextState = "suspended";
      resume = vi.fn(() => new Promise<void>((resolve) => {
        resumeContext = () => { this.state = "running"; resolve(); };
      }));
    }
    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    Object.defineProperty(window, "AudioContext", { configurable: true, value: SuspendedAudioContext });
    const { result } = renderHook(() => useSonioxTts());
    let pending!: Promise<void>;

    act(() => { pending = result.current.speak({ text: "こんにちは", language: "ja", voice: "Maya", speed: 1 }); });
    await waitFor(() => expect(SuspendedAudioContext.instance?.resume).toHaveBeenCalledTimes(1));
    act(() => result.current.stop());
    resumeContext();
    await act(async () => { await pending; });

    expect(soniox.connect).not.toHaveBeenCalled();
    expect(soniox.speak).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("does not resurrect work after unmount while AudioContext resume is pending", async () => {
    let resumeContext!: () => void;
    class SuspendedAudioContext extends FakeAudioContext {
      state: AudioContextState = "suspended";
      resume = vi.fn(() => new Promise<void>((resolve) => {
        resumeContext = () => { this.state = "running"; resolve(); };
      }));
    }
    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    Object.defineProperty(window, "AudioContext", { configurable: true, value: SuspendedAudioContext });
    const { result, unmount } = renderHook(() => useSonioxTts());
    let pending!: Promise<void>;

    act(() => { pending = result.current.speak({ text: "こんにちは", language: "ja", voice: "Maya", speed: 1 }); });
    await waitFor(() => expect(SuspendedAudioContext.instance?.resume).toHaveBeenCalledTimes(1));
    unmount();
    resumeContext();
    await act(async () => { await pending; });

    expect(soniox.connect).not.toHaveBeenCalled();
    expect(soniox.speak).not.toHaveBeenCalled();
  });

  it("reports unsupported browser playback instead of leaving an unhandled rejection", async () => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
    const { result } = renderHook(() => useSonioxTts());

    await act(async () => { await result.current.prepare(); });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("이 브라우저에서는 음성 재생을 지원하지 않습니다.");
  });

  it("cancels the adopted session when speak throws synchronously", async () => {
    soniox.speak.mockImplementationOnce(() => { throw new Error("speak failed"); });
    const { result } = renderHook(() => useSonioxTts());

    await act(async () => {
      await result.current.speak({ text: "Hello", language: "en", voice: "Maya" });
    });

    expect(soniox.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("speak failed");
  });

  it("cancels the Soniox stream and every queued source when stopped", async () => {
    const { result } = renderHook(() => useSonioxTts());
    await act(async () => {
      await result.current.speak({ text: "Hello", language: "en", voice: "Maya" });
    });
    act(() => soniox.callbacks?.onAudio(new Uint8Array([0, 0])));
    expect(result.current.phase).toBe("playing");

    act(() => result.current.stop());
    expect(soniox.cancel).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instance?.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("idle");
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("stops every queued source when the stream fails", async () => {
    const { result } = renderHook(() => useSonioxTts());
    await act(async () => {
      await result.current.speak({ text: "Hello", language: "en", voice: "Maya" });
    });
    act(() => soniox.callbacks?.onAudio(new Uint8Array([0, 0])));

    act(() => soniox.callbacks?.onError("stream failed"));

    expect(FakeAudioContext.instance?.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("stream failed");
  });
});
