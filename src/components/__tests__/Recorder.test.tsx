// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder } from "@/components/Recorder";

const recorder = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  retry: vi.fn(async () => {}),
  probe: vi.fn(async () => {}),
}));

vi.mock("@/components/useRecorder", () => ({
  useRecorder: () => ({
    phase: "idle",
    elapsedMs: 0,
    level: 0,
    error: null,
    serverStatus: null,
    finalizeResult: null,
    meetingId: null,
    hasRetainedBlob: false,
    retryDisposition: null,
    liveStatus: "idle",
    liveTranscript: {
      original: { final: "", provisional: "" },
      translation: { final: "", provisional: "" },
    },
    liveError: null,
    start: recorder.start,
    stop: recorder.stop,
    retry: recorder.retry,
    probe: recorder.probe,
  }),
}));

describe("Recorder Soniox default mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks Soniox start while configuration is checking and when it is unavailable", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    render(<Recorder defaultTranscriptionMode="soniox" />);

    expect(screen.getByRole("button", { name: "실시간 전사 설정 확인 중…" })).toBeDisabled();

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ configured: false }), { status: 200 }));
    });
    expect(await screen.findByRole("button", { name: "실시간 전사 설정 필요" })).toBeDisabled();
    expect(recorder.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: /로컬 전사/ }));
    expect(screen.getByRole("button", { name: "Whisper 전사용 녹음 시작" })).toBeEnabled();
  });

  it("starts with Soniox options only after configuration succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
    render(<Recorder defaultTranscriptionMode="soniox" />);

    const startButton = await screen.findByRole("button", { name: "실시간 전사로 녹음 시작" });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);

    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      soniox: { translation: { mode: "one_way", targetLanguage: "en" } },
    }));
  });
});
