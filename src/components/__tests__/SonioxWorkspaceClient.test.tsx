// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SonioxWorkspaceClient } from "@/components/SonioxWorkspaceClient";
import { SONIOX_SHORTCUT_STORAGE_KEY } from "@/lib/sonioxShortcuts";

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
const speech = vi.hoisted(() => ({
  phase: "idle",
  error: null as string | null,
  prepare: vi.fn(async () => {}),
  speak: vi.fn(async () => {}),
  stop: vi.fn(),
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

vi.mock("@/components/useSonioxTts", () => ({
  useSonioxTts: () => speech,
}));

describe("SonioxWorkspaceClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=translator";
    capture.phase = "idle";
    capture.transcript = {
      original: { final: "", provisional: "" },
      translation: { final: "", provisional: "" },
    };
    speech.phase = "idle";
    speech.error = null;
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

  it("uses product names as page headings and shows storage context only where files are saved", () => {
    const translator = render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "Translator" })).toBeInTheDocument();
    expect(screen.queryByText(/Soniox Workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/고객사 \/ 글로벌 영업/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("시작 전");
    translator.unmount();

    navigation.search = "workspace=workspace-a&folder=folder-a&tool=transcription";
    const transcription = render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "Smart Scribe" })).toBeInTheDocument();
    expect(screen.getByText("고객사").closest("p")).toHaveTextContent("저장 위치 · 고객사 / 글로벌 영업");
    expect(screen.queryByRole("heading", { name: "Soniox 실시간 전사" })).not.toBeInTheDocument();
    transcription.unmount();

    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "Voice Typing" })).toBeInTheDocument();
    expect(screen.queryByText(/고객사 \/ 글로벌 영업/)).not.toBeInTheDocument();
  });

  it("offers microphone and browser-tab live translation with truthful meeting limitations", () => {
    render(<SonioxWorkspaceClient />);

    expect(screen.getByRole("heading", { level: 1, name: "Translator" })).toBeInTheDocument();
    expect(screen.queryByText("고객사 / 글로벌 영업")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "오디오 입력" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "브라우저 탭 오디오 (Zoom·Google Meet 웹)" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "번역 언어" })).toBeInTheDocument();
    const languageSelect = screen.getByRole("combobox", { name: "번역 언어" });
    const languageField = languageSelect.closest("label");
    expect(languageField).toHaveClass("flex", "flex-col", "gap-2");
    expect(languageField).not.toHaveClass("md:col-span-2");
    expect(languageSelect).not.toHaveClass("md:max-w-sm");
    expect(screen.getByRole("checkbox", { name: /번역 음성 자동 재생/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "번역 음성" })).toBeInTheDocument();

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

  it("replays a completed one-way translation through Soniox TTS and supports stopping playback", async () => {
    capture.phase = "finished";
    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "Hello", provisional: "" },
    };
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.change(screen.getByRole("combobox", { name: "번역 음성" }), {
      target: { value: "Maya" },
    });
    fireEvent.click(screen.getByRole("button", { name: "번역 음성 듣기" }));
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith({
      text: "Hello",
      language: "en",
      voice: "Maya",
      speed: 1,
    }));

    speech.phase = "playing";
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "번역 음성 중지" }));
    expect(speech.stop).toHaveBeenCalledTimes(1);
  });

  it("auto-plays only after capture is finished so microphone audio cannot feed back into TTS", async () => {
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("checkbox", { name: /번역 음성 자동 재생/ }));
    expect(speech.prepare).toHaveBeenCalledTimes(1);

    capture.phase = "listening";
    capture.transcript = {
      original: { final: "안녕", provisional: "" },
      translation: { final: "Hello", provisional: "" },
    };
    view.rerender(<SonioxWorkspaceClient />);
    expect(speech.speak).not.toHaveBeenCalled();

    capture.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: "Hello",
      language: "en",
    })));
  });

  it("starts and stops Translator with its browser shortcut", () => {
    const view = render(<SonioxWorkspaceClient />);

    expect(screen.getByText("⌥ + ⇧ + T")).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true, shiftKey: true });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "one_way", targetLanguage: "en" },
    });

    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true, shiftKey: true });
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it("lets the user replace and persist the Voice Typing dictation shortcut", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const view = render(<SonioxWorkspaceClient />);

    expect(screen.getByText(/기존 Fn\/F8/)).toBeInTheDocument();
    expect(screen.getByText("⌥ + ⇧ + D")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "받아쓰기 단축키: 변경" }));
    fireEvent.keyDown(window, {
      code: "KeyK",
      key: "k",
      altKey: true,
      shiftKey: true,
    });

    expect(screen.getByText("⌥ + ⇧ + K")).toBeInTheDocument();
    expect(window.localStorage.getItem(SONIOX_SHORTCUT_STORAGE_KEY)).toContain("KeyK");
    capture.start.mockClear();
    fireEvent.keyDown(window, {
      code: "KeyK",
      key: "k",
      altKey: true,
      shiftKey: true,
    });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });

    capture.start.mockClear();
    fireEvent.keyDown(window, { code: "F8", key: "F8" });
    expect(capture.start).not.toHaveBeenCalled();

    view.unmount();
    capture.start.mockClear();
    render(<SonioxWorkspaceClient />);
    expect(screen.getByText("⌥ + ⇧ + K")).toBeInTheDocument();
    fireEvent.keyDown(window, {
      code: "KeyK",
      key: "k",
      altKey: true,
      shiftKey: true,
    });
    expect(capture.start).toHaveBeenCalledTimes(1);
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });
  });

  it("rejects a shortcut already assigned to another Soniox action", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    render(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getByRole("button", { name: "받아쓰기 단축키: 변경" }));
    fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true, shiftKey: true });

    expect(screen.getByRole("alert")).toHaveTextContent(/Translator에서 사용 중/);
    fireEvent.click(screen.getByRole("button", { name: "받아쓰기 단축키: 변경 취소" }));
    expect(screen.getByText("⌥ + ⇧ + D")).toBeInTheDocument();
    expect(window.localStorage.getItem(SONIOX_SHORTCUT_STORAGE_KEY)).toBeNull();
  });

  it("keeps shortcut editing keyboard-navigable and exposes a cancel name", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    render(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getByRole("button", { name: "받아쓰기 단축키: 변경" }));
    const cancel = screen.getByRole("button", { name: "받아쓰기 단축키: 변경 취소" });
    cancel.focus();
    expect(fireEvent.keyDown(cancel, { code: "Tab", key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(cancel, { code: "Enter", key: "Enter" })).toBe(true);
    expect(screen.getByRole("button", { name: "받아쓰기 단축키: 변경 취소" })).toBeInTheDocument();

    fireEvent.click(cancel);
    expect(screen.getByRole("button", { name: "받아쓰기 단축키: 변경" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps a changed shortcut usable but warns when browser storage is unavailable", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getByRole("button", { name: "받아쓰기 단축키: 변경" }));
    fireEvent.keyDown(window, { code: "KeyK", key: "k", altKey: true, shiftKey: true });

    expect(screen.getByText("⌥ + ⇧ + K")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/현재 탭에서만 적용/);
    setItem.mockRestore();
  });

  it("starts normal or translated voice typing from the web fallback shortcuts", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const view = render(<SonioxWorkspaceClient />);
    const finishSession = () => {
      capture.phase = "finished";
      view.rerender(<SonioxWorkspaceClient />);
      capture.phase = "idle";
      view.rerender(<SonioxWorkspaceClient />);
      capture.start.mockClear();
    };

    expect(screen.getByRole("heading", { name: "Voice Typing" })).toBeInTheDocument();
    expect(screen.getByText(/기존 Fn\/F8/)).toBeInTheDocument();
    expect(screen.getByText("⌥ + ⇧ + D")).toBeInTheDocument();
    expect(screen.getByText("⌥ + ⇧ + V")).toBeInTheDocument();
    expect(screen.getByText(/웹에서는 현재 탭에 포커스가 있을 때만/)).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "KeyD", key: "d", altKey: true, shiftKey: true });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });

    finishSession();
    fireEvent.keyDown(window, { code: "KeyV", key: "v", altKey: true, shiftKey: true });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "one_way", targetLanguage: "en" },
    });

    finishSession();
    fireEvent.keyDown(window, { code: "F8", key: "F8" });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });

    finishSession();
    fireEvent.keyDown(window, { code: "F8", key: "F8", shiftKey: true });
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "one_way", targetLanguage: "en" },
    });
  });

  it("shows which Voice Typing mode is active throughout its lifecycle", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getByRole("button", { name: "번역해서 입력" }));
    capture.phase = "connecting";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("status")).toHaveTextContent("번역 입력 연결 중");

    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("status")).toHaveTextContent("번역 중");
    expect(screen.getByRole("status")).toHaveClass("bg-successBg", "text-success");

    capture.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("status")).toHaveTextContent("번역 추가됨");
  });

  it("keeps the first Voice Typing mode when different starts race before rerender", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getByRole("button", { name: "받아쓰기 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "번역해서 입력" }));
    expect(capture.start).toHaveBeenCalledTimes(1);
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });

    capture.phase = "connecting";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("status")).toHaveTextContent("받아쓰기 연결 중");

    capture.transcript = {
      original: { final: "dictation result", provisional: "" },
      translation: { final: "translation result", provisional: "" },
    };
    capture.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("textbox", { name: "입력 결과" })).toHaveValue("dictation result");
  });

  it("registers one shortcut listener and keeps modifier shortcuts active from the output textarea", () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.change(screen.getByRole("combobox", { name: "번역 대상 언어" }), {
      target: { value: "ja" },
    });
    const output = screen.getByRole("textbox", { name: "입력 결과" });
    output.focus();
    fireEvent.keyDown(output, { code: "KeyD", key: "d", altKey: true, shiftKey: true });

    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "none" },
    });
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    view.unmount();
    expect(remove.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
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
