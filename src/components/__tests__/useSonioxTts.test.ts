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
  getSonioxTtsSpeedPlan: (requestedSpeed: number) => {
    const productSpeed = Number.isFinite(requestedSpeed) ? Math.min(2, Math.max(0.8, requestedSpeed)) : 1;
    const providerSpeed = Math.min(1.3, Math.max(0.7, productSpeed));
    return { providerSpeed, playbackRate: productSpeed / providerSpeed };
  },
}));

class FakeSource {
  buffer: { duration: number } | null = null;
  playbackRate = { value: 1 };
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

  it("turns a 2x product speed into Soniox 1.3x synthesis plus client-side playback acceleration", async () => {
    const { result } = renderHook(() => useSonioxTts());

    await act(async () => {
      await result.current.speak({ text: "Hello", language: "en", voice: "Maya", speed: 2 });
    });
    expect(soniox.connect).toHaveBeenCalledWith(expect.objectContaining({ speed: 1.3 }));

    act(() => soniox.callbacks?.onAudio(new Uint8Array([0, 0, 255, 127])));
    expect(FakeAudioContext.instance!.sources[0].playbackRate.value).toBeCloseTo(2 / 1.3);
  });

  it("never opens a provider stream in advance — only when there is text to speak", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSonioxTts());

    // prepare() unlocks audio playback inside a user gesture and nothing else.
    // A stream opened ahead of the text sits on the provider's first-stream
    // clock, and the wait before the text arrives grows with the utterance —
    // that is the 408 this design removes.
    await act(async () => { await result.current.prepare(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(soniox.connect).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.speak({ text: "こんにちは", language: "ja", voice: "Maya", speed: 1 });
    });
    expect(soniox.connect).toHaveBeenCalledTimes(1);
    expect(soniox.speak).toHaveBeenCalledWith("こんにちは");
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

    act(() => { pending = result.current.prepare(); });
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

  it("resends the utterance on a fresh stream when it fails before any audio is heard", async () => {
    const { result } = renderHook(() => useSonioxTts());
    const options = { language: "ja", voice: "Maya", speed: 1 };
    await act(async () => { await result.current.speak({ ...options, text: "こんにちは" }); });
    expect(soniox.connect).toHaveBeenCalledTimes(1);

    // The stream died without producing a single sample, so the other side heard
    // nothing. Re-send instead of showing a failure the user cannot act on.
    await act(async () => { soniox.callbacks?.onError("request timeout"); });
    await waitFor(() => expect(soniox.connect).toHaveBeenCalledTimes(2));
    expect(soniox.speak).toHaveBeenCalledTimes(2);
    expect(soniox.speak).toHaveBeenLastCalledWith("こんにちは");
    expect(result.current.error).toBeNull();
    expect(result.current.phase).not.toBe("error");
  });

  it("does not resend once audio has already been heard", async () => {
    const { result } = renderHook(() => useSonioxTts());
    const options = { language: "ja", voice: "Maya", speed: 1 };
    await act(async () => { await result.current.speak({ ...options, text: "こんにちは" }); });
    act(() => soniox.callbacks?.onAudio(new Uint8Array([0, 0, 255, 127])));

    // Half the sentence was already spoken aloud — resending would repeat it.
    await act(async () => { soniox.callbacks?.onError("stream failed"); });
    expect(soniox.connect).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("stream failed");
  });

  it("surfaces the failure after a single resend instead of looping", async () => {
    const { result } = renderHook(() => useSonioxTts());
    const options = { language: "ja", voice: "Maya", speed: 1 };
    await act(async () => { await result.current.speak({ ...options, text: "こんにちは" }); });

    await act(async () => { soniox.callbacks?.onError("request timeout"); });
    await waitFor(() => expect(soniox.connect).toHaveBeenCalledTimes(2));
    await act(async () => { soniox.callbacks?.onError("request timeout"); });

    expect(soniox.connect).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("request timeout");
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
