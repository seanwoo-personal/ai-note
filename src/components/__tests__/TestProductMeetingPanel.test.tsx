// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ session: null as null | {
  registerNavigationBlocker: ReturnType<typeof vi.fn>;
  unregisterNavigationBlocker: ReturnType<typeof vi.fn>;
} }));
vi.mock("@/components/RecorderSessionProvider", () => ({
  useOptionalRecorderSession: () => navigation.session,
}));

import { TestProductMeetingPanel } from "@/components/TestProductMeetingPanel";
import {
  applySonioxResult,
  emptySonioxTranscript,
  type SonioxResult,
  type SonioxTranscript,
} from "@/services/sonioxRealtime";

type Capture = Parameters<typeof TestProductMeetingPanel>[0]["capture"];
type Speech = Parameters<typeof TestProductMeetingPanel>[0]["speech"];

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    phase: "idle",
    transcript: emptySonioxTranscript(),
    error: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    finalize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    ...overrides,
  } as Capture;
}

function makeSpeech(overrides: Partial<Speech> = {}): Speech {
  return {
    phase: "idle",
    error: null,
    prepare: vi.fn(async () => {}),
    speak: vi.fn(async () => {}),
    stop: vi.fn(),
    ...overrides,
  } as Speech;
}

function transcriptFrom(results: SonioxResult[]): SonioxTranscript {
  return results.reduce((current, result) => applySonioxResult(current, result), emptySonioxTranscript());
}

const LOCATION = { workspaceId: "11111111-1111-4111-8111-111111111111", folderId: null };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigation.session = null;
  fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ id: "m", status: "summarized" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TestProductMeetingPanel — Global Meeting", () => {
  it("registers a discardable navigation blocker while a meeting is unsaved", () => {
    const capture = makeCapture({ phase: "listening" });
    const speech = makeSpeech();
    const registerNavigationBlocker = vi.fn();
    const unregisterNavigationBlocker = vi.fn();
    navigation.session = { registerNavigationBlocker, unregisterNavigationBlocker };

    const view = render(<TestProductMeetingPanel capture={capture} speech={speech} location={LOCATION} />);
    expect(registerNavigationBlocker).toHaveBeenCalledWith(expect.objectContaining({
      id: "global-meeting-unsaved-session",
      phase: "dirty",
      label: "트랜슬레이터 미팅",
    }));

    const blocker = registerNavigationBlocker.mock.calls[0]?.[0] as { discard: () => void };
    blocker.discard();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(speech.stop).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(unregisterNavigationBlocker).toHaveBeenCalledWith("global-meeting-unsaved-session");
  });

  it("offers TTS speeds beyond 1.2x", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    const speed = screen.getByLabelText("음성 속도") as HTMLSelectElement;
    const values = Array.from(speed.options).map((option) => option.value);
    expect(values).toContain("1.5");
    expect(values).toContain("2");
  });

  it("selects ko/en/zh/ja input languages and keeps Soniox source distinct from the translation target", () => {
    const capture = makeCapture();
    render(<TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />);
    const input = screen.getByRole("combobox", { name: "입력 언어" }) as HTMLSelectElement;
    const target = screen.getByRole("combobox", { name: "번역할 언어" }) as HTMLSelectElement;
    expect(Array.from(input.options).map((option) => option.value)).toEqual(["ko", "en", "zh", "ja"]);

    fireEvent.change(input, { target: { value: "en" } });
    expect(target.value).not.toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "en", languageB: target.value },
    });
  });

  it("keeps live placeholders translatable while marking only recognized speech as user content", () => {
    const transcript: SonioxTranscript = {
      ...emptySonioxTranscript(),
      original: { final: "", provisional: "Hello" },
      speakers: {
        "2": {
          original: { final: "", provisional: "Hello" },
          translation: { final: "", provisional: "" },
          originalLanguage: "en",
        },
      },
      activeSpeaker: "2",
    };
    render(<TestProductMeetingPanel
      capture={makeCapture({ phase: "listening", transcript })}
      speech={makeSpeech()}
      location={LOCATION}
    />);

    const liveRow = screen.getByRole("row", { name: "Speaker 2 실시간 대화 행" });
    const placeholder = within(liveRow).getByText("실시간 번역 중…");
    expect(placeholder).not.toHaveAttribute("data-i18n-user-content");
    expect(within(liveRow).getByText("Hello")).toHaveAttribute("data-i18n-user-content");
    expect(liveRow).toHaveAttribute("aria-label", "Speaker 2 실시간 대화 행");
  });

  it("pauses and resumes without ending the session or clearing the transcript", () => {
    const capture = makeCapture({ phase: "listening" });
    const { rerender } = render(
      <TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
    expect(capture.pause).toHaveBeenCalledTimes(1);

    const pausedCapture = makeCapture({ phase: "paused" });
    rerender(<TestProductMeetingPanel capture={pausedCapture} speech={makeSpeech()} location={LOCATION} />);
    const resume = screen.getByRole("button", { name: "이어서 진행" });
    fireEvent.click(resume);
    expect(pausedCapture.resume).toHaveBeenCalledTimes(1);
  });

  it("keeps a Korean-majority code-switched utterance in the Korean column and re-translates via the fallback route", async () => {
    const capture = makeCapture();
    const { rerender } = render(
      <TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />);

    // Korean speaker says "회의를 지금 시작합니다 okay" — Soniox back-translates "okay" into "오케이".
    const transcript = transcriptFrom([{
      tokens: [
        { text: "회의를 지금 시작합니다 ", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "okay", is_final: true, speaker: "1", language: "en", translation_status: "original" },
        { text: "Let's start the meeting now", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: " 오케이", is_final: true, speaker: "1", language: "ko", source_language: "en", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={makeSpeech()} location={LOCATION} />);

    // The Korean column shows the recognized Korean speech (not swapped with the English target).
    expect(await screen.findByText(/회의를 지금 시작합니다/)).toBeTruthy();
    // The corrupted Soniox back-translation is not trusted; the source text is sent to the fallback translator.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/translate", expect.any(Object)));
    const body = JSON.parse((fetchMock.mock.calls.find((call) => call[0] === "/api/translate")![1] as RequestInit).body as string);
    expect(body.text).toContain("okay");
    expect(body.targetLanguage).toBe("en");
  });

  it("opens an editable save dialog after finalization and saves only after confirmation", async () => {
    const capture = makeCapture();
    const { rerender } = render(
      <TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />);

    const transcript = transcriptFrom([{
      tokens: [
        { text: "안녕하세요", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "Hello", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={makeSpeech()} location={LOCATION} />);
    await screen.findByText("안녕하세요");

    fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/session"))).toBe(false);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "finished", transcript })} speech={makeSpeech()} location={LOCATION} />);

    const dialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    const title = within(dialog).getByRole("textbox", { name: "회의록 이름" }) as HTMLInputElement;
    expect(title.value).toContain("안녕하세요");
    expect(within(dialog).getByText(/발화 수: 1건/)).toBeTruthy();
    fireEvent.change(title, { target: { value: "고객 킥오프" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "회의록 저장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "미팅 시작" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "회의록 저장 계속" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    expect((within(reopenedDialog).getByRole("textbox", { name: "회의록 이름" }) as HTMLInputElement).value).toBe("고객 킥오프");
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "회의록 저장" }));

    await waitFor(() => {
      const sessionCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/session"));
      expect(sessionCall).toBeTruthy();
    });
    const sessionCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/session"))!;
    const body = JSON.parse((sessionCall[1] as RequestInit).body as string);
    expect(body.workspaceId).toBe(LOCATION.workspaceId);
    expect(body.transcript).toContain("안녕하세요");
    expect(body.title).toBe("고객 킥오프");
    expect(body.minutesBody).toContain("고객 킥오프");
    expect(await screen.findByText(/저장했습니다/)).toBeTruthy();
  });

  it("keeps the transcript and reports an error when the end-save fails", async () => {
    fetchMock.mockImplementation(async (input: string) => String(input).includes("/session")
      ? new Response(JSON.stringify({ error: { code: "content_save_unavailable" } }), { status: 503 })
      : new Response(JSON.stringify({ translation: "x" }), { status: 200 }));
    const capture = makeCapture();
    const { rerender } = render(
      <TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />);
    const transcript = transcriptFrom([{
      tokens: [
        { text: "안녕하세요", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "Hello", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={makeSpeech()} location={LOCATION} />);
    await screen.findByText("안녕하세요");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    });
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "finished", transcript })} speech={makeSpeech()} location={LOCATION} />);

    const dialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    fireEvent.click(within(dialog).getByRole("button", { name: "회의록 저장" }));
    expect(await within(dialog).findByText(/저장하지 못했습니다|저장에 실패/)).toBeTruthy();
    // The captured conversation and editable title are preserved for a retry.
    expect(screen.getByText("안녕하세요")).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: "회의록 이름" }) as HTMLInputElement).value).toContain("안녕하세요");
    fireEvent.click(within(dialog).getByRole("button", { name: "회의록 저장 다시 시도" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/session"))).toHaveLength(2));
  });
});
