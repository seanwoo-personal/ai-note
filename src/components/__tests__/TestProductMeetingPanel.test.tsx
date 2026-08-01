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
      label: "글로벌 미팅 번역",
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

  it("defaults 내 언어 to Korean and starts two_way translation to the selected target", () => {
    const capture = makeCapture();
    render(<TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />);
    const input = screen.getByRole("combobox", { name: "내 언어" }) as HTMLSelectElement;
    const target = screen.getByRole("combobox", { name: "상대방 언어" }) as HTMLSelectElement;
    expect(Array.from(input.options).map((option) => option.value)).toEqual(["ko", "en", "zh", "ja"]);
    expect(input.value).toBe("ko");
    expect(target.value).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "ko", languageB: "en" },
    });
  });

  it("sends the user's explicitly selected 상대방 언어 into the two-way request payload", () => {
    const capture = makeCapture();
    render(<TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />);
    const target = screen.getByRole("combobox", { name: "상대방 언어" }) as HTMLSelectElement;
    fireEvent.change(target, { target: { value: "ja" } });
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "ko", languageB: "ja" },
    });
  });

  it("keeps a concrete 내 언어 selection on two_way and distinct from 상대방 언어", () => {
    const capture = makeCapture();
    render(<TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />);
    const input = screen.getByRole("combobox", { name: "내 언어" }) as HTMLSelectElement;
    const target = screen.getByRole("combobox", { name: "상대방 언어" }) as HTMLSelectElement;

    fireEvent.change(input, { target: { value: "en" } });
    expect(target.value).not.toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "en", languageB: target.value },
    });
  });

  it.each([
    { label: "Chinese", source: "zh", original: "你好，我们开始吧", translated: "안녕하세요, 시작합시다" },
    { label: "Japanese", source: "ja", original: "会議を始めましょう", translated: "회의를 시작합시다" },
  ])("routes an automatically recognized $label utterance's original into 입력 and its generated target into 번역", async ({ source, original, translated }) => {
    const capture = makeCapture();
    const { rerender } = render(
      <TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />);

    const transcript = transcriptFrom([{
      tokens: [
        { text: original, is_final: true, speaker: "3", language: source, translation_status: "original" },
        { text: translated, is_final: true, speaker: "3", language: "ko", source_language: source, translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "3", translation_status: "original" },
      ],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={makeSpeech()} location={LOCATION} />);

    const row = await screen.findByRole("row", { name: "Speaker 3 대화 행" });
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]).getByText(original)).toBeTruthy();
    expect(within(cells[1]).getByText(translated)).toBeTruthy();
  });

  function liveTranscript(provisional: string): SonioxTranscript {
    return {
      ...emptySonioxTranscript(),
      original: { final: "", provisional },
      speakers: {
        "1": {
          original: { final: "", provisional },
          translation: { final: "", provisional: "" },
          originalLanguage: "ko",
        },
      },
      activeSpeaker: "1",
    };
  }

  it("autoscrolls the live transcript to the latest content while the user is following the bottom", () => {
    const { rerender } = render(
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: liveTranscript("안녕") })} speech={makeSpeech()} location={LOCATION} />,
    );
    const scroll = screen.getByTestId("global-meeting-transcript-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 500 });
    // Pinned near the bottom → following.
    scroll.scrollTop = 480;
    fireEvent.scroll(scroll);

    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: liveTranscript("안녕하세요 반갑습니다 오늘 회의를 시작합니다") })} speech={makeSpeech()} location={LOCATION} />);
    // The effect follows the growing content to the exact bottom.
    expect(scroll.scrollTop).toBe(500);
    expect(scroll.className).toContain("overflow-y-auto");
  });

  it("does not yank the transcript down when the user has scrolled up to read history", () => {
    const { rerender } = render(
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: liveTranscript("안녕") })} speech={makeSpeech()} location={LOCATION} />,
    );
    const scroll = screen.getByTestId("global-meeting-transcript-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 500 });
    // The user scrolls up well beyond the follow threshold to read earlier lines.
    fireEvent.wheel(scroll);
    scroll.scrollTop = 50;
    fireEvent.scroll(scroll);

    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: liveTranscript("안녕하세요 반갑습니다 오늘 회의를 시작합니다 계속 이어집니다") })} speech={makeSpeech()} location={LOCATION} />);
    // New content arrives but the reader is not pulled back to the bottom.
    expect(scroll.scrollTop).toBe(50);
  });

  it("keeps active core controls sticky, opaque, and bounded above scrolling transcript content", () => {
    render(<TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />);
    const controls = screen.getByTestId("global-meeting-controls");
    expect(controls.className).toContain("sticky");
    expect(controls.className).toContain("top-0");
    expect(controls.className).toMatch(/\bz-\d/u);
    expect(controls.className).toContain("bg-panel");
    // Narrow viewports bound the settings region to (under) the viewport height with
    // its own vertical overflow, so a controls region taller than a small screen
    // stays fully within the viewport and every core control remains reachable.
    expect(controls.className).toContain("overflow-y-auto");
    expect(controls.className).toMatch(/max-h-\[/u);
    // D3: the narrow (non-lg) cap must leave >=40% of the viewport for the
    // transcript, so its dynamic-viewport height is bounded to <=60dvh. A 92dvh cap
    // (the regression) leaves only ~8% and fails this bound.
    const dvhCap = controls.className.match(/max-h-\[(\d+)dvh\]/u);
    expect(dvhCap).not.toBeNull();
    expect(Number(dvhCap![1])).toBeLessThanOrEqual(60);
    // Desktop keeps the natural, unbounded in-flow layout.
    expect(controls.className).toContain("lg:max-h-none");
    // The full core controls (start/broadcast-segment/end) stay present and clickable
    // with >=44px (min-h-11) touch targets.
    const pause = screen.getByRole("button", { name: "일시정지" });
    const end = screen.getByRole("button", { name: "미팅 종료" });
    const broadcast = screen.getByRole("button", { name: "송출 구간 시작" });
    expect(pause).toBeEnabled();
    expect(end).toBeEnabled();
    expect(broadcast).toBeInTheDocument();
    for (const control of [pause, end, broadcast]) {
      expect(control.className).toContain("min-h-11");
    }
  });

  it("exposes the in-flow start control before a meeting begins", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    const controls = screen.getByTestId("global-meeting-controls");
    expect(controls.className).not.toContain("sticky");
    expect(within(controls).getByRole("button", { name: "미팅 시작" })).toBeEnabled();
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

  it("re-enqueues suppressed counterpart translations when the meeting ends during push-to-talk", async () => {
    const { rerender } = render(
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />,
    );
    // Left Shift starts push-to-talk; incoming counterpart jobs are now suppressed.
    fireEvent.keyDown(window, { code: "ShiftLeft" });
    fireEvent.keyUp(window, { code: "ShiftLeft" });

    const transcript = transcriptFrom([{
      tokens: [
        { text: "안녕하세요", is_final: true, speaker: "2", language: "ko", translation_status: "original" },
        { text: "<end>", is_final: true, speaker: "2", translation_status: "original" },
      ],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={makeSpeech()} location={LOCATION} />);
    await screen.findByText("안녕하세요");
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/translate")).toBe(false);

    // Ending the meeting aborts the PTT attempt; the suppressed row must not stay "번역 중…" forever.
    fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[0] === "/api/translate")).toBe(true));
    const body = JSON.parse((fetchMock.mock.calls.find((call) => call[0] === "/api/translate")![1] as RequestInit).body as string);
    expect(body.text).toBe("안녕하세요");
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
