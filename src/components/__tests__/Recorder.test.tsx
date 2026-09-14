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

    expect(screen.getByText(/실시간 전사 기능을 준비하고 있습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/SONIOX_API_KEY|Soniox/)).not.toBeInTheDocument();
  });

  it("starts with Soniox options only after configuration succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
    render(<Recorder defaultTranscriptionMode="soniox" />);

    const startButton = await screen.findByRole("button", { name: "실시간 전사로 녹음 시작" });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);

    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      audioSource: "microphone",
      soniox: { translation: { mode: "one_way", targetLanguage: "en" } },
    }));
  });

  it("lets a desktop customer include shared meeting audio in the recording", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
    render(<Recorder />);

    const source = screen.getByRole("radiogroup", { name: "녹음할 소리" });
    expect(screen.getByRole("radio", { name: "마이크만" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /마이크와 회의 소리/ }));
    fireEvent.click(screen.getByRole("button", { name: "회의 녹음 시작" }));

    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      audioSource: "microphone-and-system",
    }));
    expect(source).toHaveTextContent("Zoom");
    expect(source).toHaveTextContent("Google Meet");
  });
});
