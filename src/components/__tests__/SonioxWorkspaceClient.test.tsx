// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SonioxWorkspaceClient } from "@/components/SonioxWorkspaceClient";
import { SONIOX_SHORTCUT_STORAGE_KEY } from "@/lib/sonioxShortcuts";
import type { SonioxTranscript } from "@/services/sonioxRealtime";

const navigation = vi.hoisted(() => ({
  search: "workspace=workspace-a&folder=folder-a&tool=translator",
  replace: vi.fn(),
}));
const capture = vi.hoisted(() => ({
  phase: "idle",
  transcript: {
    original: { final: "", provisional: "" },
    translation: { final: "", provisional: "" },
    speakers: {},
    activeSpeaker: null,
    endpointCount: 0,
    lastEndpointSpeaker: null,
  } as SonioxTranscript,
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
      speakers: {},
      activeSpeaker: null,
      endpointCount: 0,
      lastEndpointSpeaker: null,
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

  it("collects Korean and English attendance and creates one translation section per speaker", () => {
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "화자 구분 통역" }));

    expect(screen.getByText(/영구 음성 생체 등록이 아니라 현재 세션의 화자 번호와 프로필을 연결/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "한국어 참석 인원" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "영어 참석 인원" }), { target: { value: "2" } });
    expect(screen.getByRole("textbox", { name: "한국어 화자 2 이름" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "영어 화자 2 이름" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(8);

    fireEvent.change(screen.getByRole("textbox", { name: "한국어 화자 1 이름" }), { target: { value: "Sean" } });
    fireEvent.change(screen.getByRole("textbox", { name: "영어 화자 1 이름" }), { target: { value: "Michelle" } });
    fireEvent.click(screen.getByRole("button", { name: "화자 등록 시작" }));

    expect(capture.start).toHaveBeenCalledWith(expect.objectContaining({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "ko", languageB: "en" },
      context: expect.objectContaining({
        general: [expect.objectContaining({ key: "speakers", value: expect.stringContaining("Sean") })],
        terms: expect.arrayContaining(["Sean", "Michelle"]),
      }),
    }));

    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getAllByRole("button", { name: "목소리 등록" })).toHaveLength(4);
  });

  it("does not let the quick-translation shortcut bypass speaker-mode setup", () => {
    render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "화자 구분 통역" }));
    capture.start.mockClear();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      code: "KeyT",
      key: "T",
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(capture.start).not.toHaveBeenCalled();
  });

  it("limits Korean and English attendance to Soniox's 15-speaker session maximum", () => {
    render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "화자 구분 통역" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "한국어 참석 인원" }), {
      target: { value: "14" },
    });

    const englishCount = screen.getByRole("spinbutton", { name: "영어 참석 인원" });
    expect(englishCount).toHaveAttribute("max", "1");
    fireEvent.change(englishCount, { target: { value: "5" } });
    expect(englishCount).toHaveValue(1);
  });

  it("does not arm speaker registration while finalized tokens are waiting for an endpoint", () => {
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "화자 구분 통역" }));
    fireEvent.click(screen.getByRole("button", { name: "화자 등록 시작" }));
    capture.phase = "listening";
    capture.transcript = {
      original: { final: "이전 문장새 문장", provisional: "" },
      translation: { final: "Previous sentenceNew sentence", provisional: "" },
      speakers: {
        "1": {
          original: { final: "이전 문장새 문장", provisional: "" },
          translation: { final: "Previous sentenceNew sentence", provisional: "" },
          originalLanguage: "ko",
          translationLanguage: "en",
        },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: "1",
      endpoints: [{
        id: 1,
        speaker: "1",
        originalFinal: "이전 문장",
        translationFinal: "Previous sentence",
      }],
    };
    view.rerender(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getAllByRole("button", { name: "목소리 등록" })[0]);

    expect(screen.getByText("현재 문장이 끝난 뒤 다시 등록해 주세요.")).toBeInTheDocument();
    expect(screen.getAllByText("미등록")).toHaveLength(2);
  });

  it("maps Korean and English speakers and plays each completed translation through speakers", async () => {
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "화자 구분 통역" }));
    expect(screen.getByText("한국어 → 영어 스피커 번역")).toBeInTheDocument();
    expect(screen.getByText("영어 → 한국어 스피커 번역")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "화자 등록 시작" }));
    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);

    fireEvent.click(screen.getAllByRole("button", { name: "목소리 등록" })[0]);
    capture.transcript = {
      original: { final: "저는 션입니다.", provisional: "" },
      translation: { final: "I am Sean.", provisional: "" },
      speakers: {
        "1": {
          original: { final: "저는 션입니다.", provisional: "" },
          translation: { final: "I am Sean.", provisional: "" },
          originalLanguage: "ko",
          translationLanguage: "en",
        },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: "1",
      endpoints: [{
        id: 1,
        speaker: "1",
        originalFinal: "저는 션입니다.",
        translationFinal: "I am Sean.",
      }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "이 화자로 확인" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "이 화자로 확인" }));
    await waitFor(() => expect(screen.getByText("등록됨 · Soniox 화자 1")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "목소리 등록" })[1]);
    capture.transcript = {
      ...capture.transcript,
      speakers: {
        ...capture.transcript.speakers,
        "2": {
          original: { final: "I am Michelle.", provisional: "" },
          translation: { final: "저는 미셸입니다.", provisional: "" },
          originalLanguage: "en",
          translationLanguage: "ko",
        },
      },
      activeSpeaker: "2",
      endpointCount: 2,
      lastEndpointSpeaker: "2",
      endpoints: [
        ...(capture.transcript.endpoints ?? []),
        {
          id: 2,
          speaker: "2",
          originalFinal: "I am Michelle.",
          translationFinal: "저는 미셸입니다.",
        },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "이 화자로 확인" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "이 화자로 확인" }));
    await waitFor(() => expect(screen.getByText("등록됨 · Soniox 화자 2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "실시간 통역 시작" }));
    expect(speech.prepare).toHaveBeenCalledTimes(1);
    const captureStopCallsBeforePlayback = capture.stop.mock.calls.length;

    capture.transcript = {
      ...capture.transcript,
      speakers: {
        ...capture.transcript.speakers,
        "1": {
          ...capture.transcript.speakers["1"],
          translation: { final: "I am Sean.Nice to meet you.", provisional: "" },
        },
      },
      activeSpeaker: "1",
      endpointCount: 3,
      lastEndpointSpeaker: "1",
      endpoints: [
        ...(capture.transcript.endpoints ?? []),
        {
          id: 3,
          speaker: "1",
          originalFinal: "저는 션입니다.",
          translationFinal: "I am Sean.Nice to meet you.",
        },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: "Nice to meet you.",
      language: "en",
    })));
    const ownSpeechCalls = speech.speak.mock.calls.length;
    speech.phase = "playing";

    capture.transcript = {
      ...capture.transcript,
      speakers: {
        ...capture.transcript.speakers,
        "2": {
          ...capture.transcript.speakers["2"],
          translation: { final: "저는 미셸입니다.반갑습니다.", provisional: "" },
        },
      },
      activeSpeaker: "2",
      endpointCount: 4,
      lastEndpointSpeaker: "2",
      endpoints: [
        ...(capture.transcript.endpoints ?? []),
        {
          id: 4,
          speaker: "2",
          originalFinal: "I am Michelle.",
          translationFinal: "저는 미셸입니다.반갑습니다.",
        },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByText("반갑습니다.", { exact: false })).toBeInTheDocument());
    expect(speech.speak).toHaveBeenCalledTimes(ownSpeechCalls);

    speech.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: "반갑습니다.",
      language: "ko",
    })));
    expect(speech.speak).toHaveBeenCalledTimes(ownSpeechCalls + 1);
    expect(capture.stop).toHaveBeenCalledTimes(captureStopCallsBeforePlayback);
  });

  it("replays a completed one-way translation through Soniox TTS and supports stopping playback", async () => {
    capture.phase = "finished";
    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "Hello", provisional: "" },
      speakers: {},
      activeSpeaker: null,
      endpointCount: 0,
      lastEndpointSpeaker: null,
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
      ...capture.transcript,
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

  it("restores and continuously saves the Voice Typing draft for its workspace", async () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    window.localStorage.setItem("ai-note-voice-typing-draft:workspace-a", "saved draft");
    const view = render(<SonioxWorkspaceClient />);

    const output = await screen.findByRole("textbox", { name: "입력 결과" });
    await waitFor(() => expect(output).toHaveValue("saved draft"));
    fireEvent.change(output, { target: { value: "edited draft" } });
    await waitFor(() => expect(window.localStorage.getItem("ai-note-voice-typing-draft:workspace-a")).toBe("edited draft"));

    view.unmount();
    render(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "입력 결과" })).toHaveValue("edited draft"));
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
      ...capture.transcript,
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
      ...capture.transcript,
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
