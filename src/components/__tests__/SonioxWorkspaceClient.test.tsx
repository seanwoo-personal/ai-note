// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    stop: capture.stop,
    reset: capture.reset,
  }),
}));

vi.mock("@/components/useSonioxTts", () => ({
  useSonioxTts: () => speech,
}));

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
    const voiceTyping = render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "Voice Typing" })).toBeInTheDocument();
    expect(screen.queryByText(/고객사 \/ 글로벌 영업/)).not.toBeInTheDocument();
    voiceTyping.unmount();

    navigation.search = "workspace=workspace-a&tool=test-product";
    render(<SonioxWorkspaceClient />);
    expect(screen.getByRole("heading", { level: 1, name: "테스트 프로덕트" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "자유 참여 글로벌 미팅" })).toBeInTheDocument();
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

  it("automatically separates test-product speakers and shows foreign speech beside Korean", async () => {
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
    expect(capture.start).toHaveBeenCalledWith({ inputSource: "microphone", translation: { mode: "none" } });

    capture.phase = "listening";
    capture.transcript = {
      original: { final: "안녕하세요はじめまして", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
        "2": { original: { final: "はじめまして", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ja" },
      },
      activeSpeaker: "2",
      endpointCount: 2,
      lastEndpointSpeaker: "2",
      endpoints: [
        { id: 1, speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "" },
        { id: 2, speaker: "2", originalLanguage: "ja", originalFinal: "はじめまして", translationFinal: "" },
      ],
    };
    view.rerender(<SonioxWorkspaceClient />);

    await waitFor(() => expect(screen.getByRole("region", { name: "한국어 회의 내용" })).toHaveTextContent("안녕하세요"));
    expect(screen.getByRole("region", { name: "상대방 언어 회의 내용" })).toHaveTextContent("화자 2");
    expect(screen.getByRole("region", { name: "상대방 언어 회의 내용" })).toHaveTextContent("はじめまして");
    expect(screen.getByRole("log", { name: "한국어 실시간 기록" })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("log", { name: "상대방 언어 실시간 기록" })).toHaveAttribute("aria-live", "polite");
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith("/api/translate", expect.objectContaining({ body: JSON.stringify({ text: "はじめまして", targetLanguage: "ko" }) }));
  });

  it("uses Space as push-to-talk and sends the captured utterance in the selected language", async () => {
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
    fireEvent.change(screen.getByRole("combobox", { name: "내 송출 대상 언어" }), { target: { value: "ja" } });
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);

    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: false });
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("내 발화 수집 중");
    expect(speech.prepare).toHaveBeenCalledTimes(1);

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
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: false });

    await waitFor(() => expect(screen.getByRole("region", { name: "상대방 언어 회의 내용" })).toHaveTextContent("こんにちは"));
    expect(screen.getByRole("region", { name: "상대방 언어 회의 내용" })).toHaveTextContent("나 · Push-to-Talk");
    expect(translate).toHaveBeenCalledWith("/api/translate", expect.objectContaining({ body: JSON.stringify({ text: "안녕하세요", targetLanguage: "ja" }) }));
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith({ text: "こんにちは", language: "ja", voice: "Maya", speed: 1 }));
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("음성 송출 중");
    speech.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("송출 완료");
  });

  it("freezes push-to-talk text and target at the closing Space before a delayed endpoint", async () => {
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
    fireEvent.change(screen.getByRole("combobox", { name: "내 송출 대상 언어" }), { target: { value: "ja" } });

    fireEvent.keyDown(window, { code: "Space", key: " " });
    capture.transcript = {
      original: { final: "안녕하세요", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 0,
      lastEndpointSpeaker: null,
      endpoints: [],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    fireEvent.change(screen.getByRole("combobox", { name: "내 송출 대상 언어" }), { target: { value: "zh" } });

    capture.transcript = {
      original: { final: "안녕하세요추가 발화", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "안녕하세요", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
        "2": { original: { final: "추가 발화", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "2",
      endpointCount: 2,
      lastEndpointSpeaker: "2",
      endpoints: [
        { id: 1, speaker: "1", originalLanguage: "ko", originalFinal: "안녕하세요", translationFinal: "" },
        { id: 2, speaker: "2", originalLanguage: "ko", originalFinal: "추가 발화", translationFinal: "" },
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

  it("recovers when push-to-talk never receives an endpoint after the closing Space", () => {
    vi.useFakeTimers();
    navigation.search = "workspace=workspace-a&tool=test-product";
    capture.phase = "listening";
    const view = render(<SonioxWorkspaceClient />);

    fireEvent.keyDown(window, { code: "Space", key: " " });
    capture.transcript = {
      original: { final: "말", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": { original: { final: "말", provisional: "" }, translation: { final: "", provisional: "" }, originalLanguage: "ko" },
      },
      activeSpeaker: "1",
      endpointCount: 0,
      lastEndpointSpeaker: null,
      endpoints: [],
    };
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("마지막 문장 확정 중");

    act(() => vi.advanceTimersByTime(8_000));

    expect(screen.getByRole("status", { name: "Push-to-Talk 상태" })).toHaveTextContent("스페이스바를 눌러");
    expect(screen.getByRole("alert")).toHaveTextContent("완료된 발화를 찾지 못했습니다");
    vi.useRealTimers();
  });

  it("presents One-way Translator and Real-time Global Meeting as the two top-level modes", () => {
    render(<SonioxWorkspaceClient />);

    const modes = screen.getByRole("group", { name: "Translator 모드" });
    expect(modes).toContainElement(screen.getByRole("button", { name: "단방향 트랜스레이터" }));
    expect(modes).toContainElement(screen.getByRole("button", { name: "실시간 글로벌 미팅" }));
    expect(screen.queryByRole("combobox", { name: "번역 방식" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One-way Translator" })).toBeInTheDocument();
  });

  it("creates four session speakers and the requested default A/B language routing", () => {
    render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 글로벌 미팅" }));

    expect(screen.getByRole("heading", { name: "Real-time Global Meeting" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "회의 참석자 수" })).toHaveValue(4);
    for (let index = 1; index <= 4; index += 1) {
      expect(screen.getByRole("textbox", { name: `화자 ${index} 이름` })).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "그룹 A 화면" })).toHaveTextContent("한국어");
    expect(screen.getByRole("region", { name: "그룹 B 화면" })).toHaveTextContent("일본어");
    expect(screen.getByRole("checkbox", { name: "그룹 A 한국어" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "그룹 A 영어" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "그룹 A 일본어" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "그룹 B 일본어" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "그룹 B 영어" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "그룹 A 상대 번역 언어" })).toHaveValue("ja");
    expect(screen.getByRole("combobox", { name: "그룹 B 상대 번역 언어" })).toHaveValue("ko");
  });

  it("registers each selected participant against an explicitly confirmed session speaker", async () => {
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 글로벌 미팅" }));
    fireEvent.click(screen.getByRole("button", { name: "화자 등록 시작" }));

    expect(capture.start).toHaveBeenCalledWith(expect.objectContaining({
      inputSource: "microphone",
      translation: { mode: "none" },
      context: expect.objectContaining({
        terms: ["화자 1", "화자 2", "화자 3", "화자 4"],
      }),
    }));

    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "화자 1 등록" }));
    expect(screen.getByText(/“안녕하세요, 화자 1입니다”라고 말해 주세요/)).toBeInTheDocument();

    capture.transcript = {
      original: { final: "안녕하세요, 화자 1입니다.", provisional: "" },
      translation: { final: "", provisional: "" },
      speakers: {
        "1": {
          original: { final: "안녕하세요, 화자 1입니다.", provisional: "" },
          translation: { final: "", provisional: "" },
          originalLanguage: "ko",
        },
      },
      activeSpeaker: "1",
      endpointCount: 1,
      lastEndpointSpeaker: "1",
      endpoints: [{ id: 1, speaker: "1", originalFinal: "안녕하세요, 화자 1입니다.", translationFinal: "" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "이 화자로 확인" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "이 화자로 확인" }));
    expect(screen.getByText("등록됨 · 세션 화자 1")).toBeInTheDocument();
  });

  it("locks mode switching while a global meeting session is active", () => {
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 글로벌 미팅" }));
    fireEvent.click(screen.getByRole("button", { name: "화자 등록 시작" }));
    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);

    const oneWay = screen.getByRole("button", { name: "단방향 트랜스레이터" });
    expect(oneWay).toBeDisabled();
    fireEvent.click(oneWay);
    expect(screen.getByRole("heading", { name: "Real-time Global Meeting" })).toBeInTheDocument();
  });

  it("routes each completed speaker utterance to the opposite group display language", async () => {
    const translate = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { targetLanguage: string };
      return new Response(JSON.stringify({ translation: body.targetLanguage === "ja" ? "こんにちは。" : "안녕하세요." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", translate);
    const view = render(<SonioxWorkspaceClient />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 글로벌 미팅" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "회의 참석자 수" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "화자 등록 시작" }));
    capture.phase = "listening";
    view.rerender(<SonioxWorkspaceClient />);

    const register = async (ordinal: number, speaker: string, endpointId: number) => {
      fireEvent.click(screen.getByRole("button", { name: `화자 ${ordinal} 등록` }));
      const original = `안녕하세요, 화자 ${ordinal}입니다.`;
      capture.transcript = {
        ...capture.transcript,
        original: { final: `${capture.transcript.original.final}${original}`, provisional: "" },
        speakers: {
          ...capture.transcript.speakers,
          [speaker]: {
            original: { final: original, provisional: "" },
            translation: { final: "", provisional: "" },
          },
        },
        activeSpeaker: speaker,
        endpointCount: endpointId,
        lastEndpointSpeaker: speaker,
        endpoints: [...(capture.transcript.endpoints ?? []), { endpointId, id: endpointId, speaker, originalFinal: original, translationFinal: "" }],
      } as SonioxTranscript;
      view.rerender(<SonioxWorkspaceClient />);
      await waitFor(() => expect(screen.getByRole("button", { name: "이 화자로 확인" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "이 화자로 확인" }));
    };

    await register(1, "1", 1);
    await register(2, "2", 2);
    fireEvent.click(screen.getByRole("button", { name: "글로벌 미팅 시작" }));
    expect(speech.prepare).toHaveBeenCalledTimes(1);

    capture.transcript = {
      ...capture.transcript,
      original: { final: `${capture.transcript.original.final}한국에서 왔습니다.`, provisional: "" },
      speakers: {
        ...capture.transcript.speakers,
        "1": { original: { final: "안녕하세요, 화자 1입니다.한국에서 왔습니다.", provisional: "" }, translation: { final: "", provisional: "" } },
      },
      activeSpeaker: "1",
      endpointCount: 3,
      lastEndpointSpeaker: "1",
      endpoints: [...(capture.transcript.endpoints ?? []), { id: 3, speaker: "1", originalFinal: "안녕하세요, 화자 1입니다.한국에서 왔습니다.", translationFinal: "" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("region", { name: "그룹 B 화면" })).toHaveTextContent("こんにちは。"));
    expect(screen.getByRole("region", { name: "그룹 B 화면" })).toHaveTextContent("일본어");
    fireEvent.change(screen.getByRole("combobox", { name: "그룹 A 상대 번역 언어" }), { target: { value: "en" } });
    expect(screen.getByRole("region", { name: "그룹 B 화면" })).toHaveTextContent("다음 번역: 영어");
    expect(screen.getByRole("region", { name: "그룹 B 화면" })).toHaveTextContent("일본어");
    expect(translate).toHaveBeenLastCalledWith("/api/translate", expect.objectContaining({ body: JSON.stringify({ text: "한국에서 왔습니다.", targetLanguage: "ja" }) }));
    await waitFor(() => expect(speech.speak).toHaveBeenNthCalledWith(1, { text: "こんにちは。", language: "ja", voice: "Maya", speed: 1 }));
    speech.phase = "connecting";

    capture.transcript = {
      ...capture.transcript,
      original: { final: `${capture.transcript.original.final}日本から来ました。`, provisional: "" },
      speakers: {
        ...capture.transcript.speakers,
        "2": { original: { final: "안녕하세요, 화자 2입니다.日本から来ました。", provisional: "" }, translation: { final: "", provisional: "" } },
      },
      activeSpeaker: "2",
      endpointCount: 4,
      lastEndpointSpeaker: "2",
      endpoints: [...(capture.transcript.endpoints ?? []), { id: 4, speaker: "2", originalFinal: "안녕하세요, 화자 2입니다.日本から来ました。", translationFinal: "" }],
    };
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(screen.getByRole("region", { name: "그룹 A 화면" })).toHaveTextContent("안녕하세요."));
    expect(translate).toHaveBeenLastCalledWith("/api/translate", expect.objectContaining({ body: JSON.stringify({ text: "日本から来ました。", targetLanguage: "ko" }) }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    speech.phase = "finished";
    view.rerender(<SonioxWorkspaceClient />);
    await waitFor(() => expect(speech.speak).toHaveBeenNthCalledWith(2, { text: "안녕하세요.", language: "ko", voice: "Maya", speed: 1 }));
    vi.unstubAllGlobals();
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
