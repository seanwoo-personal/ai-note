// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordingCaptureErrorMessage,
  requestRecordingCapture,
} from "@/lib/recordingCapture";

class FakeTrack {
  stop = vi.fn();
  constructor(readonly kind: "audio" | "video" = "audio") {}
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
}

describe("recordingCapture", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mixes microphone and shared meeting audio into one recording stream and releases every track", async () => {
    const microphoneTrack = new FakeTrack();
    const meetingTrack = new FakeTrack();
    const pickerVideoTrack = new FakeTrack("video");
    const mixedTrack = new FakeTrack();
    const microphone = new FakeStream([microphoneTrack]) as unknown as MediaStream;
    const shared = new FakeStream([meetingTrack, pickerVideoTrack]) as unknown as MediaStream;
    const mixed = new FakeStream([mixedTrack]) as unknown as MediaStream;
    const connect = vi.fn();
    const close = vi.fn(async () => {});
    const resume = vi.fn(async () => {});
    const getDisplayMedia = vi.fn(async () => shared);
    const getUserMedia = vi.fn(async () => microphone);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia, getUserMedia },
    });
    vi.stubGlobal("AudioContext", class {
      createMediaStreamDestination() { return { stream: mixed }; }
      createMediaStreamSource() { return { connect }; }
      close = close;
      resume = resume;
    });

    const capture = await requestRecordingCapture("microphone-and-system");

    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(capture.stream).toBe(mixed);

    capture.release();
    expect(microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(meetingTrack.stop).toHaveBeenCalledOnce();
    expect(pickerVideoTrack.stop).toHaveBeenCalledOnce();
    expect(mixedTrack.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a shared surface without audio and tells the customer how to retry", async () => {
    const pickerVideoTrack = new FakeTrack("video");
    const shared = new FakeStream([pickerVideoTrack]) as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn(async () => shared), getUserMedia: vi.fn() },
    });

    const failure = await requestRecordingCapture("microphone-and-system").catch((caught) => caught);

    expect(recordingCaptureErrorMessage("microphone-and-system", failure)).toMatch(/오디오 공유.*켜고/);
    expect(pickerVideoTrack.stop).toHaveBeenCalledOnce();
  });
});
