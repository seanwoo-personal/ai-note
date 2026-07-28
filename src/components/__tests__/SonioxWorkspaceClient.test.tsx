// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SonioxWorkspaceClient } from "@/components/SonioxWorkspaceClient";

const navigation = vi.hoisted(() => ({
  search: "workspace=workspace-a&folder=folder-a&tool=translator",
  replace: vi.fn(),
}));
const capture = vi.hoisted(() => ({
  phase: "idle",
  transcript: {
    original: { final: "", provisional: "" },
    translation: { final: "", provisional: "" },
  },
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => navigation,
}));

vi.mock("@/components/LibraryProvider", () => ({
  useLibrary: () => ({
    mode: "ready",
    library: {
      defaultWorkspaceId: "workspace-a",
      workspaces: [{ id: "workspace-a", name: "고객사" }],
      folders: [{ id: "folder-a", workspaceId: "workspace-a", name: "글로벌 영업" }],
    },
  }),
}));

const recorder = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock("@/components/Recorder", () => ({
  Recorder: (props: unknown) => {
    recorder.render(props);
    return <div data-testid="recorder">회의 녹음기</div>;
  },
}));

vi.mock("@/components/useSonioxLiveCapture", () => ({
  useSonioxLiveCapture: () => ({
    phase: capture.phase,
    transcript: capture.transcript,
    error: null,
    start: capture.start,
    stop: capture.stop,
    reset: capture.reset,
  }),
}));

describe("SonioxWorkspaceClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=translator";
    capture.phase = "idle";
    capture.transcript = {
      original: { final: "", provisional: "" },
      translation: { final: "", provisional: "" },
    };
  });

  it("canonicalizes invalid workspace, folder, and tool query parameters", async () => {
    navigation.search = "workspace=missing&folder=missing&tool=unknown&extra=1";
    render(<SonioxWorkspaceClient />);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(
      "/soniox?workspace=workspace-a&tool=transcription",
    ));
  });

  it("opens the folder recorder with Soniox selected by default", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=transcription";
    render(<SonioxWorkspaceClient />);
    expect(screen.getByTestId("recorder")).toBeInTheDocument();
    expect(recorder.render).toHaveBeenCalledWith(expect.objectContaining({
      requestedLocation: { workspaceId: "workspace-a", folderId: "folder-a" },
      defaultTranscriptionMode: "soniox",
    }));
  });

  it("lets the user cancel a pending Soniox connection", () => {
    capture.phase = "requesting";
    render(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getByRole("button", { name: "연결 취소" }));
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it("offers microphone and browser-tab live translation with truthful meeting limitations", () => {
    render(<SonioxWorkspaceClient />);

    expect(screen.getByRole("heading", { name: "실시간 번역" })).toBeInTheDocument();
    expect(screen.getByText("고객사 / 글로벌 영업")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "오디오 입력" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "브라우저 탭 오디오 (Zoom·Google Meet 웹)" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "번역 언어" })).toBeInTheDocument();
    expect(screen.getByText(/번역 음성을 회의 상대에게 자동으로 보내지는 않습니다/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "오디오 입력" }), {
      target: { value: "browser-tab" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "번역 언어" }), {
      target: { value: "ja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "실시간 번역 시작" }));
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "browser-tab",
      translation: { mode: "one_way", targetLanguage: "ja" },
    });
  });

  it("starts normal or translated voice typing from the web fallback shortcuts", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    render(<SonioxWorkspaceClient />);

    expect(screen.getByRole("heading", { name: "Voice Typing" })).toBeInTheDocument();
    expect(screen.getByText("Fn")).toBeInTheDocument();
    expect(screen.getByText("Fn + Shift")).toBeInTheDocument();
    expect(screen.getByText(/웹에서는 현재 탭에 포커스가 있을 때만/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "F8" });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });
  });

  it("does not append a finished utterance again when cleanup is toggled", async () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    capture.phase = "finished";
    capture.transcript = {
      original: { final: "hello", provisional: "" },
      translation: { final: "", provisional: "" },
    };
    render(<SonioxWorkspaceClient />);

    const output = screen.getByRole("textbox", { name: "입력 결과" });
    await waitFor(() => expect(output).toHaveValue("hello"));
    fireEvent.click(screen.getByRole("checkbox", { name: /깔끔하게 입력/ }));
    expect(output).toHaveValue("hello");
  });
});
