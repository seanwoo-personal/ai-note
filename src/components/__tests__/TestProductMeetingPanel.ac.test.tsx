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

// Controllable IntersectionObserver so the floating-control test can flip the
// in-flow primary button in/out of the viewport deterministically.
let ioCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;
class MockIntersectionObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    ioCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

beforeEach(() => {
  navigation.session = null;
  ioCallbacks = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver as unknown as typeof IntersectionObserver);
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

async function startMeetingWithOneUtterance() {
  const { rerender } = render(
    <TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />,
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
  return { rerender, transcript };
}

describe("TestProductMeetingPanel — AC1/AC2 truthful language labels", () => {
  it("labels the two language selectors exactly 내 언어 and 상대방 언어 and drops the recognition-controlling label", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    expect(screen.getByRole("combobox", { name: "내 언어" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "상대방 언어" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "입력 언어" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "번역할 언어" })).toBeNull();
  });

  it("states that speaker language is recognized automatically per utterance", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    expect(screen.getAllByText(/발화마다 자동으로 인식/).length).toBeGreaterThan(0);
  });

  it("keeps 내 언어 wired to Soniox two-way languageA and 상대방 언어 to languageB", () => {
    const capture = makeCapture();
    render(<TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />);
    const mine = screen.getByRole("combobox", { name: "내 언어" }) as HTMLSelectElement;
    const other = screen.getByRole("combobox", { name: "상대방 언어" }) as HTMLSelectElement;
    expect(Array.from(mine.options).map((option) => option.value)).toEqual(["ko", "en", "zh", "ja"]);
    fireEvent.change(mine, { target: { value: "en" } });
    expect(other.value).not.toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(capture.start).toHaveBeenCalledWith({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: "en", languageB: other.value },
    });
  });
});

describe("TestProductMeetingPanel — AC3/AC4 columns and visual separation", () => {
  it("uses exactly 입력 and 번역 as the conversation column headers", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["입력", "번역"]);
  });

  it("keeps a non-selected source language original in 입력 and its generated translation in 번역", async () => {
    const transcript = transcriptFrom([{
      tokens: [
        { text: "こんにちは", is_final: true, speaker: "7", language: "ja", translation_status: "original" },
        { text: "Hello", is_final: true, speaker: "7", language: "en", source_language: "ja", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "7", translation_status: "original" },
      ],
    }]);
    render(<TestProductMeetingPanel
      capture={makeCapture({ phase: "listening", transcript })}
      speech={makeSpeech()}
      location={LOCATION}
    />);

    const row = await screen.findByRole("row", { name: "Speaker 7 대화 행" });
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["こんにちは", "Hello"]);
  });

  it("separates the settings surface from the transcript history surface with distinct tokens", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    const settings = document.querySelector("[data-surface='settings']");
    const transcript = screen.getByRole("region", { name: "대화 기록" });
    expect(settings).toBeTruthy();
    expect(transcript.getAttribute("data-surface")).toBe("transcript");
    // Distinct background tokens so the two surfaces are visually separable.
    expect(settings?.className).not.toEqual(transcript.className);
  });
});

describe("TestProductMeetingPanel — AC5/AC6/AC7 scroll follow", () => {
  it("keeps a pointer-drag gesture pending through an intermediate near-bottom scroll", () => {
    render(<TestProductMeetingPanel
      capture={makeCapture({ phase: "listening" })}
      speech={makeSpeech()}
      location={LOCATION}
    />);
    const region = screen.getByRole("region", { name: "대화 기록" });
    Object.defineProperty(region, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(region, "clientHeight", { value: 300, configurable: true });

    fireEvent.pointerDown(region);
    region.scrollTop = 660;
    fireEvent.scroll(region);
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();

    region.scrollTop = 0;
    fireEvent.scroll(region);
    expect(screen.getByRole("button", { name: "최신 내용 보기" })).toBeTruthy();
  });

  it("follows an asynchronous translation update even when the entry count is unchanged", async () => {
    let resolveTranslation: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/translate")) {
        return await new Promise<Response>((resolve) => { resolveTranslation = resolve; });
      }
      return new Response(JSON.stringify({ id: "m", status: "summarized" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const transcript = transcriptFrom([{
      tokens: [
        { text: "Hello without inline translation", is_final: true, speaker: "2", language: "en", translation_status: "original" },
        { text: "<end>", is_final: true, speaker: "2", translation_status: "original" },
      ],
    }]);
    render(<TestProductMeetingPanel
      capture={makeCapture({ phase: "listening", transcript })}
      speech={makeSpeech()}
      location={LOCATION}
    />);
    const region = screen.getByRole("region", { name: "대화 기록" });
    const scrollTo = vi.fn();
    (region as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    Object.defineProperty(region, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(region, "clientHeight", { value: 300, configurable: true });

    await waitFor(() => expect(resolveTranslation).toBeTruthy());
    scrollTo.mockClear();
    resolveTranslation?.(new Response(JSON.stringify({ translation: "비동기 번역 완료" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await screen.findByText("비동기 번역 완료");
    expect(scrollTo).toHaveBeenCalled();
  });

  it("reveals an explicit latest-content control only after the user scrolls up, and resuming scrolls to bottom", () => {
    render(<TestProductMeetingPanel
      capture={makeCapture({ phase: "listening" })}
      speech={makeSpeech()}
      location={LOCATION}
    />);
    const region = screen.getByRole("region", { name: "대화 기록" });
    const scrollTo = vi.fn();
    (region as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    Object.defineProperty(region, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(region, "clientHeight", { value: 300, configurable: true });

    // Following at the bottom: no latest button.
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();

    // User scrolls up (real gesture) -> user-reading -> latest button appears.
    fireEvent.wheel(region);
    region.scrollTop = 0;
    fireEvent.scroll(region);
    const latest = screen.getByRole("button", { name: "최신 내용 보기" });

    // Explicit resume scrolls to the bottom and hides the control again.
    scrollTo.mockClear();
    fireEvent.click(latest);
    expect(scrollTo).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();
  });

  it("starts a saved meeting's next session with fresh follow and gesture state", async () => {
    const { rerender, transcript } = await startMeetingWithOneUtterance();
    const region = screen.getByRole("region", { name: "대화 기록" });
    const scrollTo = vi.fn();
    (region as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    Object.defineProperty(region, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(region, "clientHeight", { value: 300, configurable: true });

    fireEvent.wheel(region);
    region.scrollTop = 0;
    fireEvent.scroll(region);
    expect(screen.getByRole("button", { name: "최신 내용 보기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "finished", transcript })} speech={makeSpeech()} location={LOCATION} />);
    const dialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    fireEvent.click(within(dialog).getByRole("button", { name: "회의록 저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "회의록 저장" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "미팅 시작" }));
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();
    // The real capture.reset synchronously publishes an empty transcript before
    // the next session starts receiving provider events.
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={makeSpeech()} location={LOCATION} />);
    expect(screen.queryByText("안녕하세요")).toBeNull();

    const firstNewTranscript = transcriptFrom([{
      tokens: [
        { text: "새 회의 첫 발화", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "New meeting first", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]);
    scrollTo.mockClear();
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: firstNewTranscript })} speech={makeSpeech()} location={LOCATION} />);
    await screen.findByText("새 회의 첫 발화");
    expect(scrollTo).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();

    const continuousNewTranscript = transcriptFrom([
      { tokens: [
        { text: "새 회의 첫 발화", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "New meeting first", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ] },
      { tokens: [
        { text: "새 회의 연속 발화", is_final: true, speaker: "2", language: "ko", translation_status: "original" },
        { text: "New meeting continuous", is_final: true, speaker: "2", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "2", translation_status: "original" },
      ] },
    ]);
    scrollTo.mockClear();
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: continuousNewTranscript })} speech={makeSpeech()} location={LOCATION} />);
    await screen.findByText("새 회의 연속 발화");
    expect(scrollTo).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();
  });
});

describe("TestProductMeetingPanel — AC8 floating primary control", () => {
  it("mirrors the in-flow primary control when it scrolls out of view and shares its handler", () => {
    const capture = makeCapture();
    render(<TestProductMeetingPanel capture={capture} speech={makeSpeech()} location={LOCATION} />);
    // In view -> a single primary button and no floating duplicate.
    expect(screen.getAllByRole("button", { name: "미팅 시작" }).length).toBe(1);
    expect(document.querySelector("[data-floating-primary]")).toBeNull();

    // Primary scrolls out of view -> floating mirror appears wired to the same handler.
    act(() => ioCallbacks.forEach((cb) => cb([{ isIntersecting: false }])));
    expect(screen.getAllByRole("button", { name: "미팅 시작" }).length).toBe(2);
    const floater = document.querySelector("[data-floating-primary]") as HTMLButtonElement;
    expect(floater).toBeTruthy();
    fireEvent.click(floater);
    expect(capture.start).toHaveBeenCalledTimes(1);
  });

  it("hides the floating control again once the in-flow control returns to view", () => {
    render(<TestProductMeetingPanel capture={makeCapture()} speech={makeSpeech()} location={LOCATION} />);
    act(() => ioCallbacks.forEach((cb) => cb([{ isIntersecting: false }])));
    expect(document.querySelector("[data-floating-primary]")).toBeTruthy();
    act(() => ioCallbacks.forEach((cb) => cb([{ isIntersecting: true }])));
    expect(document.querySelector("[data-floating-primary]")).toBeNull();
  });
});

describe("TestProductMeetingPanel — AC9/AC10 discard", () => {
  it("offers a distinct 폐기하기 action that confirms, clears memory, resets user-reading, and never calls save or delete", async () => {
    const { rerender } = await startMeetingWithOneUtterance();
    const region = screen.getByRole("region", { name: "대화 기록" });
    Object.defineProperty(region, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(region, "clientHeight", { value: 300, configurable: true });
    fireEvent.wheel(region);
    region.scrollTop = 0;
    fireEvent.scroll(region);
    expect(screen.getByRole("button", { name: "최신 내용 보기" })).toBeTruthy();
    const finishedCapture = makeCapture({ phase: "finished", transcript: transcriptFrom([{
      tokens: [
        { text: "안녕하세요", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "Hello", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]) });
    fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    rerender(<TestProductMeetingPanel capture={finishedCapture} speech={makeSpeech()} location={LOCATION} />);

    const dialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    const discard = within(dialog).getByRole("button", { name: "폐기하기" });
    const save = within(dialog).getByRole("button", { name: "회의록 저장" });
    // Discard is visually distinct (destructive) from save.
    expect(discard.className).not.toEqual(save.className);

    fireEvent.click(discard);
    // Mistake-prevention confirmation; save is not reachable in the confirm step.
    expect(within(dialog).getByText(/되돌릴 수 없습니다/)).toBeTruthy();
    expect(within(dialog).getByText(/저장된 다른 회의록에는 영향을 주지 않습니다/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "회의록 저장" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "폐기 확정" }));
    // Discard resets the live capture (which clears the transcript in the real hook).
    expect(finishedCapture.reset).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "회의록 저장" })).not.toBeInTheDocument());
    // Simulate capture.reset() emptying the transcript on the next render.
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "idle" })} speech={makeSpeech()} location={LOCATION} />);

    // In-memory conversation is cleared and we are back to a fresh follow session.
    expect(screen.getByRole("button", { name: "미팅 시작" })).toBeTruthy();
    expect(screen.queryByText("안녕하세요")).toBeNull();
    expect(screen.queryByRole("button", { name: "최신 내용 보기" })).toBeNull();
    // No save endpoint call and no destructive network request whatsoever.
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/session"))).toBe(false);
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    expect(finishedCapture.reset).toHaveBeenCalled();
  });

  it("can back out of the discard confirmation and still save", async () => {
    const { rerender } = await startMeetingWithOneUtterance();
    const finishedCapture = makeCapture({ phase: "finished", transcript: transcriptFrom([{
      tokens: [
        { text: "안녕하세요", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "Hello", is_final: true, speaker: "1", language: "en", source_language: "ko", translation_status: "translation" },
        { text: "<end>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]) });
    fireEvent.click(screen.getByRole("button", { name: "미팅 종료" }));
    rerender(<TestProductMeetingPanel capture={finishedCapture} speech={makeSpeech()} location={LOCATION} />);

    const dialog = await screen.findByRole("dialog", { name: "회의록 저장" });
    fireEvent.click(within(dialog).getByRole("button", { name: "폐기하기" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "돌아가기" }));
    // Back on the save step: title + save available, conversation intact.
    fireEvent.click(within(dialog).getByRole("button", { name: "회의록 저장" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/session"))).toBe(true));
  });
});
