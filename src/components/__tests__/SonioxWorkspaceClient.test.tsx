// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SonioxWorkspaceClient } from "@/components/SonioxWorkspaceClient";
import { SONIOX_SHORTCUT_STORAGE_KEY } from "@/lib/sonioxShortcuts";
import type { SonioxTranscript } from "@/services/sonioxRealtime";

const navigation = vi.hoisted(() => ({
  search: "workspace=workspace-a&folder=folder-a&tool=translator",
  replace: vi.fn(),
}));
const capture = vi.hoisted(() => ({
  phase: "idle",
  error: null as string | null,
  transcript: {
    original: { final: "", provisional: "" },
    translation: { final: "", provisional: "" },
    speakers: {},
    activeSpeaker: null,
    endpointCount: 0,
    lastEndpointSpeaker: null,
  } as SonioxTranscript,
  start: vi.fn(async () => {}),
  finalize: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
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
    error: capture.error,
    start: capture.start,
    finalize: capture.finalize,
    stop: capture.stop,
    reset: capture.reset,
  }),
}));

vi.mock("@/components/useSonioxTts", () => ({
  useSonioxTts: () => speech,
}));

const PTT_OPENING_ENDPOINT = { id: 1, kind: "fin" as const, speaker: null, originalLanguage: "unknown", originalFinal: "", translationFinal: "" };

function completePttOpeningBoundary(view: ReturnType<typeof render>) {
  capture.transcript = {
    original: { final: "", provisional: "" },
    translation: { final: "", provisional: "" },
    speakers: {},
    activeSpeaker: null,
    endpointCount: 1,
    lastEndpointSpeaker: null,
    endpoints: [PTT_OPENING_ENDPOINT],
  };
  view.rerender(<SonioxWorkspaceClient />);
}

describe("SonioxWorkspaceClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=translator";
    capture.phase = "idle";
    capture.error = null;
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
      "/live?workspace=workspace-a&tool=transcription",
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

  it("uses product names as page headings and shows storage context only where files are saved", () => {
    const translator = render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "글로벌 미팅 번역" })).toBeInTheDocument();
    expect(screen.queryByText(/Soniox Workspace/i)).not.toBeInTheDocument();
    expect(screen.getByText("고객사").closest("p")).toHaveTextContent("저장 위치 · 고객사 / 글로벌 영업");
    translator.unmount();

    navigation.search = "workspace=workspace-a&folder=folder-a&tool=transcription";
    const transcription = render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "미팅노트" })).toBeInTheDocument();
    expect(screen.getByText("고객사").closest("p")).toHaveTextContent("저장 위치 · 고객사 / 글로벌 영업");
    expect(screen.queryByRole("heading", { name: "실시간 전사" })).not.toBeInTheDocument();
    transcription.unmount();

    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    const voiceTyping = render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "음성 입력" })).toBeInTheDocument();
    expect(screen.queryByText(/고객사 \/ 글로벌 영업/)).not.toBeInTheDocument();
    voiceTyping.unmount();

    navigation.search = "workspace=workspace-a&tool=test-product";
    render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "글로벌 미팅 번역" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "자유 참여 글로벌 미팅" })).toBeInTheDocument();
  });

  it("keeps Global Meeting utterances in one aligned transcript with Speaker labels", async () => {
    const translate = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      return new Response(JSON.stringify({ translation: body.text === "はじめまして" ? "안녕하세요" : body.text }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    const view = render(<SonioxWorkspaceClient />);

    expect(screen.queryByRole("spinbutton", { name: "회의 참석자 수" })).not.toBeInTheDocument();
    expect(screen.queryByText(/그룹 A|그룹 B/)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "스페인어" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(capture.start).toHaveBeenCalledWith({ inputSource: "microphone", translation: { mode: "two_way", languageA: "ko", languageB: "en" } });

    capture.phase = "listening";
    capture.transcript = {
      original: { final: "안녕하세요はじめまして", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "Hello", provisional: "" }, originalLanguage: "ko", translationLanguage: "en" },
        "2": { original: { final: "はじめまして", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ja" },
      },
      activeSpeaker: "2",
      endpointCount: 2,
      lastEndpointSpeaker: "2",
      endpoints: [
        { id: 1, speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "Hello" },
        { id: 2, speaker: "2", originalLanguage: "ja", originalFinal: "はじめまして", translationFinal: "" },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);

    const transcript = await screen.findByRole("table", { name: "글로벌 미팅 번역 대화록" });
    expect(transcript).toHaveAttribute("aria-live", "polite");
    const speaker1 = within(transcript).getByRole("row", { name: "Speaker 1 대화 행" });
    const speaker2 = within(transcript).getByRole("row", { name: "Speaker 2 대화 행" });
    expect(speaker1).toHaveTextContent("안녕하세요");
    expect(speaker1).toHaveTextContent("Hello");
    expect(speaker2).toHaveTextContent("안녕하세요");
    expect(speaker2).toHaveTextContent("はじめまして");
    expect(transcript).not.toHaveTextContent("화자 2");
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith("/api/translate", expect.objectContaining({ body: JSON.stringify({ text: "はじめまして", targetLanguage: "ko" }) }));
  });

  it("falls back to the selected counterpart language when a Korean endpoint has no final translation", async () => {
    const translate = vi.fn(async () => new Response(JSON.stringify({ translation: "Hello" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: "1",
      endpoints: [{ id: 1, speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "" }],
    };

    render(<SonioxWorkspaceClient />);

    await waitFor(() => expect(translate).toHaveBeenCalledWith("/api/translate", expect.objectContaining({
      body: JSON.stringify({ text: "안녕하세요", targetLanguage: "en" }),
    })));
    await waitFor(() => expect(screen.getByRole("table", { name: "글로벌 미팅 번역 대화록" })).toHaveTextContent("Hello"));
  });

  it("renders Soniox provisional translation while a test-product utterance is still in progress", () => {
    const translate = vi.fn();
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    capture.transcript = {
      original: { final: "", provisional: "Hello" },
      translation: { final: "", provisional: "안녕하세요" },
      speakers: {
        "2": {
          original: { final: "", provisional: "Hello" },
          translation: { final: "", provisional: "안녕하세요" },
          originalLanguage: "en",
          translationLanguage: "ko",
        },
      },
      activeSpeaker: "2",
      endpointCount: 0,
      lastEndpointSpeaker: null,
      endpoints: [],
    };

    render(<SonioxWorkspaceClient />);

    expect(screen.getByRole("table", { name: "글로벌 미팅 번역 대화록" })).toHaveTextContent("안녕하세요");
    expect(screen.getByRole("table", { name: "글로벌 미팅 번역 대화록" })).toHaveTextContent("Hello");
    expect(translate).not.toHaveBeenCalled();
  });

  it("uses the live Soniox translation immediately at closing Left Shift without waiting for the LLM adapter", async () => {
    const translate = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { targetLanguage: string };
      return new Response(JSON.stringify({ translation: body.targetLanguage === "ja" ? "こんにちは" : "안녕하세요" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.change(screen.getByRole("combobox", { name: "번역할 언어" }), { target: { value: "ja" } });
    fireEvent.change(screen.getByRole("combobox", { name: "번역 음성" }), { target: { value: "Daniel" } });
    fireEvent.change(screen.getByRole("combobox", { name: "음성 속도" }), { target: { value: "1.2" } });
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);

    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift", repeat: false });
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("실시간 번역 및 음성 연결 준비 중");
    expect(speech.prepare).toHaveBeenCalledWith({ language: "ja", voice: "Daniel", speed: 1.2 });
    completePttOpeningBoundary(view);

    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "こんにちは", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "こんにちは", provisional: "" }, originalLanguage: "ko", translationLanguage: "ja" },
      },
      activeSpeaker: "1",
      endpointCount: 2,
      lastEndpointSpeaker: "1",
      endpoints: [PTT_OPENING_ENDPOINT, { id: 2, speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "こんにちは" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift", repeat: false });

    const pttRow = await screen.findByRole("row", { name: "Speaker 1 Push-to-Talk 대화 행" });
    expect(pttRow).toHaveTextContent("こんにちは");
    expect(within(pttRow).getByText("안녕하세요").closest("p")).toHaveClass("font-bold");
    expect(within(pttRow).getByText("こんにちは").closest("p")).toHaveClass("font-bold");
    expect(within(pttRow).getByText("안녕하세요")).not.toHaveClass("italic");
    expect(screen.getAllByText("안녕하세요")).toHaveLength(1);
    expect(screen.getAllByText("こんにちは")).toHaveLength(1);
    expect(pttRow).not.toHaveClass("bg-error/5");
    expect(screen.getByText("Speaker 1 · Push-to-Talk")).not.toHaveClass("text-error");
    expect(translate).not.toHaveBeenCalled();
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith({ text: "こんにちは", language: "ja", voice: "Daniel", speed: 1.2 }));
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("음성 송출 중");
    speech.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("송출 완료");
  });

  it("finalizes an in-progress Soniox turn and speaks its completed live translation without an LLM round trip", async () => {
    const translate = vi.fn();
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.change(screen.getByRole("combobox", { name: "번역할 언어" }), { target: { value: "ja" } });

    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });
    completePttOpeningBoundary(view);
    capture.transcript = {
      original: { final: "", provisional: "안녕하세요" },
      translation: { final: "", provisional: "こんにちは" },
      speakers: {
        "1": {
          original: { final: "", provisional: "안녕하세요" },
          translation: { final: "", provisional: "こんにちは" },
          originalLanguage: "ko",
          translationLanguage: "ja",
        },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: null,
      endpoints: [PTT_OPENING_ENDPOINT],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });

    expect(capture.finalize).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마지막 토큰 확정 중");

    capture.transcript = {
      original: { final: "다른 사람", provisional: "안녕하세요" },
      translation: { final: "Other person", provisional: "こんにちは" },
      speakers: {
        "1": {
          original: { final: "", provisional: "안녕하세요" },
          translation: { final: "", provisional: "こんにちは" },
          originalLanguage: "ko",
          translationLanguage: "ja",
        },
        "2": {
          original: { final: "다른 사람", provisional: "" },
          translation: { final: "Other person", provisional: "" },
          originalLanguage: "ko",
          translationLanguage: "ja",
        },
      },
      activeSpeaker: "2",
      endpointCount: 2,
      lastEndpointSpeaker: "2",
      endpoints: [PTT_OPENING_ENDPOINT, { id: 2, kind: "end", speaker: "2", originalLanguage: "ko", originalFinal: "다른 사람", translationFinal: "Other person" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마지막 토큰 확정 중");

    capture.transcript = {
      original: { final: "다른 사람안녕하세요후속 발화", provisional: "" },
      translation: { final: "Other personこんにちは後の発言", provisional: "" },
      speakers: {
        "1": {
          original: { final: "안녕하세요후속 발화", provisional: "" },
          translation: { final: "こんにちは後の発言", provisional: "" },
          originalLanguage: "ko",
          translationLanguage: "ja",
        },
        "2": {
          original: { final: "다른 사람", provisional: "" },
          translation: { final: "Other person", provisional: "" },
          originalLanguage: "ko",
          translationLanguage: "ja",
        },
      },
      activeSpeaker: "2",
      endpointCount: 4,
      lastEndpointSpeaker: "1",
      endpoints: [
        PTT_OPENING_ENDPOINT,
        { id: 2, kind: "end", speaker: "2", originalLanguage: "ko", originalFinal: "다른 사람", translationFinal: "Other person" },
        { id: 3, kind: "fin", speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "こんにちは" },
        { id: 4, kind: "end", speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요후속 발화", translationFinal: "こんにちは後の発言" },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);

    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith({ text: "こんにちは", language: "ja", voice: "Maya", speed: 1 }));
    expect(translate).not.toHaveBeenCalled();
    expect(speech.speak).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Other person") }));
    expect(screen.getByText("후속 발화")).toBeInTheDocument();
    expect(screen.getByText("後の発言")).toBeInTheDocument();
  });

  it("freezes push-to-talk text and target at the closing Left Shift before a delayed endpoint", async () => {
    const translate = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string; targetLanguage: string };
      return new Response(JSON.stringify({ translation: `${body.targetLanguage}:${body.text}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.change(screen.getByRole("combobox", { name: "번역할 언어" }), { target: { value: "ja" } });

    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });
    completePttOpeningBoundary(view);
    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: null,
      endpoints: [PTT_OPENING_ENDPOINT],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });
    expect(capture.finalize).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole("combobox", { name: "번역할 언어" }), { target: { value: "zh" } });

    capture.transcript = {
      original: { final: "안녕하세요추가 발화", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요추가 발화", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 3,
      lastEndpointSpeaker: "1",
      endpoints: [
        PTT_OPENING_ENDPOINT,
        { id: 2, kind: "fin", speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "" },
        { id: 3, kind: "end", speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요추가 발화", translationFinal: "" },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);

    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    expect(translate).toHaveBeenCalledWith("/api/translate", expect.objectContaining({
      body: JSON.stringify({ text: "안녕하세요", targetLanguage: "ja" }),
    }));
  });

  it("stops test-product capture and speech when leaving the section", () => {
    navigation.search = "workspace=workspace-a&tool=test-product";
    const view = render(<SonioxWorkspaceClient />);
    view.unmount();

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(speech.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps translated text visible while exposing test-product speech playback errors", () => {
    navigation.search = "workspace=workspace-a&tool=test-product";
    speech.phase = "error";
    speech.error = "브라우저에서 번역 음성을 재생할 수 없습니다.";

    render(<SonioxWorkspaceClient />);

    expect(screen.getByRole("alert")).toHaveTextContent("브라우저에서 번역 음성을 재생할 수 없습니다");
  });

  it("shows microphone and Soniox capture failures in the test-product panel", () => {
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "error";
    capture.error = "마이크 권한을 허용해 주세요.";

    render(<SonioxWorkspaceClient />);

    expect(screen.getByRole("alert")).toHaveTextContent("마이크 권한을 허용해 주세요");
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(capture.reset).toHaveBeenCalledTimes(1);
  });

  it("recovers when push-to-talk never receives an endpoint after the closing Left Shift", () => {
    vi.useFakeTimers();
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });
    completePttOpeningBoundary(view);
    capture.transcript = {
      original: { final: "말", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "말", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: null,
      endpoints: [PTT_OPENING_ENDPOINT],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마지막 토큰 확정 중");

    act(() => vi.advanceTimersByTime(8_000));

    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마이크와 실시간 번역");
    expect(screen.getByRole("alert")).toHaveTextContent("완료된 발화를 찾지 못했습니다");
    vi.useRealTimers();
  });

  it("starts Push-to-Talk only with Left Shift after mouse-starting the meeting", () => {
    navigation.search = "workspace=workspace-a&tool=test-product";
    const view = render(<SonioxWorkspaceClient />);

    const startButton = screen.getByRole("button", { name: "미팅 시작" });
    startButton.focus();
    fireEvent.click(startButton);
    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);

    fireEvent.keyDown(document.activeElement ?? window, { code: "Space", key: " " });
    fireEvent.keyDown(document.activeElement ?? window, { code: "ShiftRight", key: "Shift" });
    fireEvent.keyDown(document.activeElement ?? window, { code: "ShiftLeft", key: "Shift" });
    expect(capture.finalize).not.toHaveBeenCalled();

    fireEvent.keyUp(document.activeElement ?? window, { code: "ShiftRight", key: "Shift" });
    fireEvent.keyDown(document.activeElement ?? window, { code: "ShiftLeft", key: "Shift" });
    expect(capture.finalize).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("Left Shift를 다시 누르세요");

    fireEvent.keyDown(document.activeElement ?? window, { code: "ShiftLeft", key: "Shift", repeat: true });
    expect(capture.finalize).toHaveBeenCalledTimes(1);
  });

  it("does not hijack Left Shift from focused buttons, links, or inputs", () => {
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    render(<><a href="/settings">설정 링크</a><input aria-label="안전 입력" /><div tabIndex={0} aria-label="포커스 영역" /><div contentEditable aria-label="편집 영역" /><SonioxWorkspaceClient /></>);

    const targets = [
      screen.getByRole("button", { name: "일시정지" }),
      screen.getByRole("link", { name: "설정 링크" }),
      screen.getByRole("textbox", { name: "안전 입력" }),
      screen.getByLabelText("포커스 영역"),
      screen.getByLabelText("편집 영역"),
    ];
    for (const target of targets) {
      target.focus();
      fireEvent.keyDown(target, { code: "ShiftLeft", key: "Shift" });
    }

    expect(capture.finalize).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마이크와 실시간 번역");
  });

  it("aborts a stalled outbound translation and restores push-to-talk", async () => {
    vi.useFakeTimers();
    const stalledTranslation = vi.fn((_url: string, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
    }));
    vi.stubGlobal("fetch", stalledTranslation);
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });
    completePttOpeningBoundary(view);
    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 2,
      lastEndpointSpeaker: "1",
      endpoints: [PTT_OPENING_ENDPOINT, { id: 2, speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "ShiftLeft", key: "Shift" });

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마이크와 실시간 번역");
    expect(screen.getByRole("alert")).toHaveTextContent("번역하지 못했습니다");
  });

  it("keeps the current FIFO lock when an aborted prior-generation translation settles late", async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    let translationCount = 0;
    const translate = vi.fn((input: string) => {
      if (input.includes("/session")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "saved-meeting" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      translationCount += 1;
      return translationCount === 1
        ? new Promise<Response>((_resolve, reject) => { rejectFirst = reject; })
        : new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", translate);
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    capture.transcript = {
      original: { final: "첫 발화", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: { "1": { original: { final: "첫 발화", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ja" } },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: "1",
      endpoints: [{ id: 1, speaker: "1", originalLanguage: "ja", originalFinal: "첫 발화", translationFinal: "" }],
    };
    const view = render(<SonioxWorkspaceClient />);
    const translationCalls = () => translate.mock.calls.filter(([input]) => input === "/api/translate");
    await waitFor(() => expect(translationCalls()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    capture.phase = "idle";
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "회의록 저장 계속" }));
    const dialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    fireEvent.click(within(dialog).getByRole("button", { name: "회의록 저장" }));
    await screen.findByText(/저장했습니다/);
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    capture.phase = "listening";
    capture.transcript = {
      original: { final: "두 번째", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: { "2": { original: { final: "두 번째", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ja" } },
      activeSpeaker: "2",
      endpointCount: 2,
      lastEndpointSpeaker: "2",
      endpoints: [{ id: 2, speaker: "2", originalLanguage: "ja", originalFinal: "두 번째", translationFinal: "" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(translationCalls()).toHaveLength(2));

    await act(async () => {
      rejectFirst?.(new DOMException("Aborted", "AbortError"));
      await Promise.resolve();
    });
    capture.transcript = {
      ...capture.transcript,
      original: { final: "두 번째세 번째", provisional: "" },
      endpointCount: 3,
      endpoints: [
        ...(capture.transcript.endpoints ?? []),
        { id: 3, speaker: "3", originalLanguage: "ja", originalFinal: "세 번째", translationFinal: "" },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await act(async () => { await Promise.resolve(); });

    expect(translationCalls()).toHaveLength(2);
  });

  it("lets the user replace and persist the 음성 입력 dictation shortcut", () => {
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

    expect(screen.getByRole("heading", { name: "음성 입력" })).toBeInTheDocument();
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

  it("shows which 음성 입력 mode is active throughout its lifecycle", () => {
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

  it("restores and continuously saves the 음성 입력 draft for its workspace", async () => {
    navigation.search = "workspace=workspace-a&folder=folder-a&tool=voice-typing";
    window.localStorage.setItem("ai-note-voice-typing-draft:workspace-a", "saved draft");
    const view = render(<SonioxWorkspaceClient />);

    const output = await screen.findByRole("textbox", { name: "입력 결과" });

    fireEvent.change(output, { target: { value: "edited draft" } });
    await waitFor(() => expect(window.localStorage.getItem("ai-note-voice-typing-draft:workspace-a")).toBe("edited draft"));

    view.unmount();
    render(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "입력 결과" })).toHaveValue("edited draft"));
  });

  it("keeps the first 음성 입력 mode when different starts race before rerender", () => {
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
