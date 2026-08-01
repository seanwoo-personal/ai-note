// @vitest-environment jsdom
//
// Repeated push-to-talk (Left Shift) finalization recovery — task t_7b6f15f0.
//
// These tests exercise the closing half of a Left Shift push-to-talk cycle, where
// the panel freezes the outbound utterance, waits for its final Soniox endpoint,
// and broadcasts the translation. Three failure modes are covered here as separate
// vertical RED→GREEN slices (evidence: test-results/global-meeting-ptt-t_7b6f15f0):
//   H1 — a valid final endpoint that arrives after the idle deadline is lost.
//   H2 — repeated-use diarization speaker-ID drift rejects a valid new final.
//   H3 — a stale boundary/other-speaker provisional falsely enters "finalizing".
import { act, fireEvent, render, screen } from "@testing-library/react";
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  navigation.session = null;
  // Distinct payloads per endpoint so an outbound Push-to-Talk broadcast (which
  // must translate + speak) is observable separately from an ordinary incoming
  // counterpart translation.
  fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.includes("/api/translate")) return jsonResponse({ translation: "OUTBOUND-TARGET" });
    return jsonResponse({ id: "m", status: "summarized" });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// Flush pending promise microtasks (fetch/json chains) under fake timers.
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// Texts sent to /api/translate so far, in call order.
function translateTexts(): string[] {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes("/api/translate"))
    .map((call) => JSON.parse((call[1] as RequestInit).body as string).text as string);
}

describe("TestProductMeetingPanel — push-to-talk finalization recovery", () => {
  it("H1: broadcasts a valid final endpoint that arrives after the idle deadline instead of losing it", async () => {
    vi.useFakeTimers();
    const capture = makeCapture({ phase: "listening" });
    const speech = makeSpeech();
    const { rerender } = render(
      <TestProductMeetingPanel capture={capture} speech={speech} location={LOCATION} />,
    );

    // First Left Shift opens the outbound push-to-talk segment; capture.finalize()
    // flushes the opening boundary that marks where the user's utterance begins.
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    const opened = transcriptFrom([{
      tokens: [{ text: "<fin>", is_final: true, speaker: "1", translation_status: "original" }],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: opened })} speech={speech} location={LOCATION} />);

    // The user speaks; the words are visible live (provisional) but Soniox has not
    // yet emitted the utterance's final endpoint.
    const speaking = transcriptFrom([{
      tokens: [
        { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" },
        { text: "제안을 드리자면", is_final: false, speaker: "1", language: "ko", translation_status: "original" },
      ],
    }]);
    rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: speaking })} speech={speech} location={LOCATION} />);

    // Second Left Shift closes the segment while the endpoint is still pending →
    // the panel enters "finalizing" and waits for the final boundary.
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // The endpoint is slow: more than the 8s idle deadline elapses before it lands.
    act(() => { vi.advanceTimersByTime(8_000); });

    // Now the delayed final endpoint finally commits for the same speaker.
    const finalized = transcriptFrom([{
      tokens: [
        { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" },
        { text: "제안을 드리자면 이렇게 하시죠", is_final: true, speaker: "1", language: "ko", translation_status: "original" },
        { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" },
      ],
    }]);
    await act(async () => {
      rerender(<TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript: finalized })} speech={speech} location={LOCATION} />);
    });
    await flush(10);

    // The utterance must be broadcast (translated to the target and spoken), not
    // silently dropped or demoted to an ordinary incoming row.
    expect(speech.speak).toHaveBeenCalled();
    expect(screen.getByText("Speaker 1 · Push-to-Talk")).toBeTruthy();
    expect(screen.queryByLabelText("Push-to-Talk 상태")?.textContent).not.toContain("완료된 발화를 찾지 못했습니다");
  });

  it("H2: broadcasts a repeated push-to-talk even when diarization drifts the user's speaker ID", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const prepare = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, prepare, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );

    const { rerender } = render(
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={speechAt()} location={LOCATION} />,
    );

    // ---- Cycle 1: a clean push-to-talk that pins this session's speaker to "1". ----
    const openFin1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const final1 = { text: "안녕하세요", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));                     // opening flush boundary
    rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }] }]))); // finalized utterance
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                    // close → immediate enqueue
    await flush();
    // Drain the outbound speech so the phase can settle to "sent" before cycle 2.
    const cycle1 = transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }] }]);
    await act(async () => { rerender(listening(cycle1, "finished")); });
    await flush();
    expect(screen.getByText("Speaker 1 · Push-to-Talk")).toBeTruthy();
    expect(speak).toHaveBeenCalledTimes(1);

    // ---- Cycle 2: the SAME user, but diarization now labels them speaker "2". ----
    // The opening flush is attributed to the previously-active speaker "1".
    const openFin2 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const prov2 = { text: "다음 안건을 말씀드리겠습니다", is_final: false, speaker: "2", language: "ko", translation_status: "original" as const };
    const final2 = { text: "다음 안건을 말씀드리겠습니다", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const endFin2 = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };

    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                    // open cycle 2
    rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }, openFin2] }]), "finished"));
    rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }, openFin2, prov2] }]), "finished"));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                    // close cycle 2 → finalizing
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // The drifted final boundary lands under speaker "2", not the pinned "1".
    const finalized2 = transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }, openFin2, final2, endFin2] }]);
    await act(async () => { rerender(listening(finalized2, "finished")); });
    await flush(10);

    // The user's second utterance must still be broadcast under the drifted speaker,
    // not rejected by the exact pinned-speaker filter and lost.
    expect(screen.getByText("Speaker 2 · Push-to-Talk")).toBeTruthy();
    expect(speak).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText("Push-to-Talk 상태")?.textContent).not.toContain("완료된 발화를 찾지 못했습니다");
  });

  it("drift progress: keeps cycle 2 alive when the unambiguous pre-final speaker advances before the 8s tick", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );
    const boundary1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const final1 = { text: "첫 번째 발화", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    const cycle1 = [boundary1, final1, { ...boundary1 }];

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [boundary1] }])));
    rerender(listening(transcriptFrom([{ tokens: cycle1 }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: cycle1 }]), "finished")); });
    await flush();
    expect(speak).toHaveBeenCalledTimes(1);

    // Cycle 2 opens while the session pin still points at speaker 1, but the user's
    // pre-final provisional is now attributed to the sole drift candidate, speaker 2.
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    const opening2 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const provisional = (text: string) => ({ text, is_final: false, speaker: "2", language: "ko", translation_status: "original" as const });
    const cycle2Base = [...cycle1, opening2];
    rerender(listening(transcriptFrom([{ tokens: cycle2Base }]), "finished"));
    rerender(listening(transcriptFrom([{ tokens: [...cycle2Base, provisional("두 번째")] }]), "finished"));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // Real byte progress occurs under the unambiguous drift candidate before the
    // first deadline. The pinned-speaker-only implementation abandons here.
    rerender(listening(transcriptFrom([{ tokens: [...cycle2Base, provisional("두 번째 발화가 계속됩니다")] }]), "finished"));
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    const final2 = { text: "두 번째 발화가 계속됩니다", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const end2 = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [...cycle2Base, final2, end2] }]), "finished")); });
    await flush(10);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Speaker 2 · Push-to-Talk")).toBeTruthy();
  });

  it("drift progress: keeps finalizing when the sole candidate moves from provisional to final before its delayed endpoint", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );
    const fin1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const final1 = { text: "첫 발화", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    const cycle1 = [fin1, final1, { ...fin1 }];
    const { rerender } = render(listening(emptySonioxTranscript()));

    // Cycle 1 establishes the session pin as speaker 1.
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [fin1] }])));
    rerender(listening(transcriptFrom([{ tokens: cycle1 }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: cycle1 }]), "finished")); });
    await flush();
    expect(speak).toHaveBeenCalledTimes(1);

    // Cycle 2 is the same user drifted to speaker 2. Close while their bytes are
    // provisional, then Soniox promotes those exact bytes to final without emitting
    // the delayed <fin> endpoint yet.
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    const base = [...cycle1, { ...fin1 }];
    const provisional2 = { text: "두 번째 최종 발화", is_final: false, speaker: "2", language: "ko", translation_status: "original" as const };
    const final2 = { ...provisional2, is_final: true };
    rerender(listening(transcriptFrom([{ tokens: base }]), "finished"));
    rerender(listening(transcriptFrom([{ tokens: [...base, provisional2] }]), "finished"));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");
    rerender(listening(transcriptFrom([{ tokens: [...base, final2] }]), "finished"));

    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");
    act(() => { vi.advanceTimersByTime(1_001); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    const end2 = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [...base, final2, end2] }]), "finished")); });
    await flush(10);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Speaker 2 · Push-to-Talk")).toBeTruthy();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("송출 완료");
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("내 송출 구간");
  });

  it("drift progress: treats same-length rewrite and shrink correction as byte-different advancement", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );
    const fin1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const final1 = { text: "첫 발화", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    const cycle1 = [fin1, final1, { ...fin1 }];
    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [fin1] }])));
    rerender(listening(transcriptFrom([{ tokens: cycle1 }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: cycle1 }]), "finished")); });
    await flush();

    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    const opening2 = { ...fin1 };
    const base = [...cycle1, opening2];
    const provisional = (text: string) => ({ text, is_final: false, speaker: "2", language: "ko", translation_status: "original" as const });
    rerender(listening(transcriptFrom([{ tokens: base }]), "finished"));
    rerender(listening(transcriptFrom([{ tokens: [...base, provisional("가나다")] }]), "finished"));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });

    // Providers may rewrite an unstable token span without changing its byte length.
    rerender(listening(transcriptFrom([{ tokens: [...base, provisional("라마바")] }]), "finished"));
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // A correction may also shrink the provisional while still representing progress.
    rerender(listening(transcriptFrom([{ tokens: [...base, provisional("라")] }]), "finished"));
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    const final2 = { text: "라 최종 발화", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const end2 = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [...base, final2, end2] }]), "finished")); });
    await flush(10);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Speaker 2 · Push-to-Talk")).toBeTruthy();
  });

  it("drift progress: enforces an absolute bound even when the candidate rewrites forever", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );
    const fin1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const final1 = { text: "첫 발화", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    const cycle1 = [fin1, final1, { ...fin1 }];
    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [fin1] }])));
    rerender(listening(transcriptFrom([{ tokens: cycle1 }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: cycle1 }]), "finished")); });
    await flush();

    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    const base = [...cycle1, { ...fin1 }];
    const provisional = (text: string) => ({ text, is_final: false, speaker: "2", language: "ko", translation_status: "original" as const });
    rerender(listening(transcriptFrom([{ tokens: base }]), "finished"));
    rerender(listening(transcriptFrom([{ tokens: [...base, provisional("가")] }]), "finished"));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });

    // Every interval gets byte-different candidate text. Progress may extend the idle
    // window, but cannot remove the absolute 32s finalization bound.
    for (const text of ["나", "다", "라"]) {
      rerender(listening(transcriptFrom([{ tokens: [...base, provisional(text)] }]), "finished"));
      act(() => { vi.advanceTimersByTime(8_000); });
      await flush();
      expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");
    }
    rerender(listening(transcriptFrom([{ tokens: [...base, provisional("마")] }]), "finished"));
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("완료된 발화를 찾지 못했습니다");
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("Left Shift로 내 송출 구간을 시작");
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("monotonic deadline: abandons on the first callback after a suspended clock crosses 32s", async () => {
    vi.useFakeTimers();
    let monotonicNow = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => monotonicNow);
    const speech = makeSpeech();
    const listening = (transcript: SonioxTranscript) => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speech} location={LOCATION} />
    );
    const provisional = (text: string) => ({
      text,
      is_final: false,
      speaker: "1",
      language: "ko",
      translation_status: "original" as const,
    });

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));
    rerender(listening(transcriptFrom([{ tokens: [openFin1, provisional("정지 전 발화")] }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // The tab/event loop is suspended. Transcript bytes change while no timer callback
    // can run, and the monotonic clock crosses the absolute 32s policy deadline. When
    // the first coalesced callback finally executes, progress/grace must not re-arm it.
    rerender(listening(transcriptFrom([{ tokens: [openFin1, provisional("정지 중에도 바뀐 발화")] }])));
    monotonicNow = 33_001;
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("완료된 발화를 찾지 못했습니다");
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("Left Shift로 내 송출 구간을 시작");
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("내 송출 구간");
  });

  it("H3: broadcasts the user's already-finalized utterance without stalling on another speaker's live speech", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const prepare = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, prepare, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );

    const { rerender } = render(
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening" })} speech={speechAt()} location={LOCATION} />,
    );

    // ---- Cycle 1: clean push-to-talk that pins this session's speaker to "1". ----
    const openFin1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const final1 = { text: "안녕하세요", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));
    rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }] }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }] }]), "finished")); });
    await flush();
    expect(speak).toHaveBeenCalledTimes(1);

    // ---- Cycle 2: the user finishes their own utterance, then another participant
    // ("2") starts talking BEFORE the user presses the closing Left Shift. ----
    const base = [openFin1, final1, { ...openFin1 }];
    const openFinB = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const finalB = { text: "회의를 마치겠습니다", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };
    const endFinB = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
    const provOther = { text: "잠시만요 저도", is_final: false, speaker: "2", language: "ko", translation_status: "original" as const };

    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [...base, openFinB] }]), "finished"));                       // opening flush
    rerender(listening(transcriptFrom([{ tokens: [...base, openFinB, finalB, endFinB] }]), "finished"));      // user finalized
    rerender(listening(transcriptFrom([{ tokens: [...base, openFinB, finalB, endFinB, provOther] }]), "finished")); // other starts
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                                          // close cycle 2

    // The user's utterance is already complete, so it must broadcast immediately —
    // it must NOT stall in "finalizing" waiting for a boundary that (for the user)
    // has already passed, merely because another speaker is mid-sentence.
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush(10);

    expect(speak).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/Speaker 1 · Push-to-Talk/)).toHaveLength(2);
    expect(screen.queryByLabelText("Push-to-Talk 상태")?.textContent).not.toContain("완료된 발화를 찾지 못했습니다");
    expect(screen.queryByLabelText("Push-to-Talk 상태")?.textContent).not.toContain("마지막 토큰 확정 중");
  });

  // Shared open/close helpers for the coverage cases below.
  const openFin1 = { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const };
  const final1 = { text: "안녕하세요 반갑습니다", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const };

  it("AC5/AC6: abandons a genuinely empty finalization exactly at the 8s boundary and recovers a stranded counterpart", async () => {
    vi.useFakeTimers();
    const speech = makeSpeech();
    const listening = (transcript: SonioxTranscript) => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speech} location={LOCATION} />
    );
    const otherFinal = { text: "질문이 하나 있습니다", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const otherFin = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };
    const provSelf = { text: "어", is_final: false, speaker: "1", language: "ko", translation_status: "original" as const };

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // open
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));                     // opening flush
    // While recording, another participant's utterance lands — its counterpart is suppressed.
    rerender(listening(transcriptFrom([{ tokens: [openFin1, otherFinal, otherFin] }])));
    expect(screen.getByText("질문이 하나 있습니다")).toBeTruthy();
    expect(translateTexts()).not.toContain("질문이 하나 있습니다");
    // The user only ever produces provisional audio (no endpoint is coming).
    rerender(listening(transcriptFrom([{ tokens: [openFin1, otherFinal, otherFin, provSelf] }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // close → finalizing
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // 1 ms before the deadline, nothing has been abandoned yet.
    act(() => { vi.advanceTimersByTime(7_999); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");
    // Soniox drops the provisional audio without ever emitting a boundary.
    rerender(listening(transcriptFrom([{ tokens: [openFin1, otherFinal, otherFin] }])));
    // Exactly at the boundary the empty finalization is abandoned.
    act(() => { vi.advanceTimersByTime(1); });
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("완료된 발화를 찾지 못했습니다");
    // The counterpart stranded during the aborted push-to-talk is recovered.
    expect(translateTexts()).toContain("질문이 하나 있습니다");
  });

  it("AC6: re-enters recording on a subsequent Left Shift after a completed broadcast", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));
    rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }] }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // close cycle 1
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [openFin1, final1, { ...openFin1 }] }]), "finished")); });
    await flush();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("송출 완료");

    // A fresh Left Shift must re-enter the recording state (release/re-entry).
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("내 송출 구간");
  });

  it("AC7: resumes ordinary realtime counterpart translation after a push-to-talk broadcast", async () => {
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );
    const base = [openFin1, final1, { ...openFin1 }];
    const otherFinal = { text: "그건 제가 확인해 보겠습니다", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const otherFin = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));
    rerender(listening(transcriptFrom([{ tokens: base }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // broadcast cycle 1
    await flush();
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: base }]), "finished")); });
    await flush();
    expect(speak).toHaveBeenCalledTimes(1);

    // After the broadcast settles, an ordinary incoming utterance is translated normally.
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [...base, otherFinal, otherFin] }]), "finished")); });
    await flush();
    expect(translateTexts()).toContain("그건 제가 확인해 보겠습니다");
  });

  it("liveness: a byte-identical stale provisional is abandoned within a BOUNDED number of intervals (not re-armed forever)", async () => {
    // Reviewer finding (t_3c3f0474 #1): the idle net treated ANY non-empty provisional
    // as progress, so an unchanging/stale provisional that never endpoints re-armed the
    // 8s timer forever — the push-to-talk attempt could never abandon. Progress must be
    // measured by observable transcript ADVANCEMENT (endpoint count / more text), not by
    // mere non-empty presence. A single grace interval is still granted so a genuinely
    // slow (>8s) but IMMINENT boundary is not cut off (see the delayed-progress case).
    vi.useFakeTimers();
    const speech = makeSpeech();
    const listening = (transcript: SonioxTranscript) => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speech} location={LOCATION} />
    );
    // Another participant completes an utterance while the user is recording — its
    // counterpart translation is suppressed and must be recovered when the attempt aborts.
    const otherFinal = { text: "다른 참가자의 완성된 발화입니다", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const otherFin = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };
    // The user only ever emits this provisional token; Soniox never endpoints it and the
    // bytes never change across intervals.
    const staleSelf = { text: "어 그러니까", is_final: false, speaker: "1", language: "ko", translation_status: "original" as const };

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // open
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));                     // opening flush
    rerender(listening(transcriptFrom([{ tokens: [openFin1, otherFinal, otherFin] }]))); // other participant lands
    expect(screen.getByText("다른 참가자의 완성된 발화입니다")).toBeTruthy();
    expect(translateTexts()).not.toContain("다른 참가자의 완성된 발화입니다");
    rerender(listening(transcriptFrom([{ tokens: [openFin1, otherFinal, otherFin, staleSelf] }]))); // stale provisional
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // close → finalizing
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // First interval (8s): a still-present provisional earns exactly one grace interval,
    // so the attempt is NOT abandoned yet (a legitimately slow boundary is preserved).
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.queryByRole("alert")?.textContent ?? "").not.toContain("완료된 발화를 찾지 못했습니다");
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // Second interval (16s): the provisional is byte-identical — no endpoint, no new
    // text — so with the grace already spent the attempt is deterministically abandoned.
    // (The pre-fix code re-armed here forever and never reached this state.)
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("완료된 발화를 찾지 못했습니다");
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("Left Shift로 내 송출 구간을 시작");
    // The counterpart stranded during the aborted push-to-talk is recovered.
    expect(translateTexts()).toContain("다른 참가자의 완성된 발화입니다");

    // Idle is genuinely restored: a fresh Left Shift re-enters recording.
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("내 송출 구간");

    // No further timer fires after abandon+re-entry beyond the new recording session.
    act(() => { vi.advanceTimersByTime(40_000); });
  });

  it("liveness: keeps waiting past 8s while the provisional keeps ADVANCING and still broadcasts a very delayed final", async () => {
    // The mirror-image guarantee: as long as the user's transcript is genuinely
    // advancing (the provisional keeps growing), the idle net must keep waiting well
    // beyond 8s and broadcast the boundary whenever it finally lands — the fix must not
    // abandon a legitimately slow-but-progressing utterance.
    vi.useFakeTimers();
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript) => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt()} location={LOCATION} />
    );
    const prov = (text: string) => ({ text, is_final: false, speaker: "1", language: "ko", translation_status: "original" as const });

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // open
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));                     // opening flush
    rerender(listening(transcriptFrom([{ tokens: [openFin1, prov("천천히")] }])));       // user starts speaking
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // close → finalizing
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // The provisional grows before each idle fire → real advancement → keep waiting.
    rerender(listening(transcriptFrom([{ tokens: [openFin1, prov("천천히 말하는")] }])));
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    rerender(listening(transcriptFrom([{ tokens: [openFin1, prov("천천히 말하는 발언입니다")] }])));
    act(() => { vi.advanceTimersByTime(8_000); });
    await flush();
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");
    expect(screen.queryByRole("alert")?.textContent ?? "").not.toContain("완료된 발화를 찾지 못했습니다");

    // Well after 16s the delayed final finally lands for the same speaker → broadcast.
    const finalized = transcriptFrom([{
      tokens: [
        openFin1,
        { text: "천천히 말하는 발언입니다 이제 끝", is_final: true, speaker: "1", language: "ko", translation_status: "original" as const },
        { text: "<fin>", is_final: true, speaker: "1", translation_status: "original" as const },
      ],
    }]);
    await act(async () => { rerender(listening(finalized)); });
    await flush(10);
    expect(speak).toHaveBeenCalled();
    expect(screen.getByText("Speaker 1 · Push-to-Talk")).toBeTruthy();
    expect(screen.queryByLabelText("Push-to-Talk 상태")?.textContent).not.toContain("완료된 발화를 찾지 못했습니다");
  });

  it("liveness: the idle timer is torn down on unmount and never fires afterwards", async () => {
    vi.useFakeTimers();
    const speech = makeSpeech();
    const listening = (transcript: SonioxTranscript) => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speech} location={LOCATION} />
    );
    const staleSelf = { text: "어", is_final: false, speaker: "1", language: "ko", translation_status: "original" as const };

    const { rerender, unmount } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));
    rerender(listening(transcriptFrom([{ tokens: [openFin1, staleSelf] }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // → finalizing (timer armed)
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("마지막 토큰 확정 중");

    // Unmount tears the timer down; advancing the fake clock must not throw or update
    // state on an unmounted tree.
    expect(() => {
      unmount();
      act(() => { vi.advanceTimersByTime(40_000); });
    }).not.toThrow();
  });

  it("AC6/AC7: an outbound translation failure recovers to idle and keeps ordinary realtime running", async () => {
    vi.useFakeTimers();
    // Every /api/translate call fails (no usable translation in the payload).
    fetchMock.mockImplementation(async (input: string) => String(input).includes("/api/translate")
      ? jsonResponse({}, 200)
      : jsonResponse({ id: "m" }));
    const speak = vi.fn(async () => {});
    const speechAt = (phase: Speech["phase"] = "idle") => makeSpeech({ speak, phase });
    const listening = (transcript: SonioxTranscript, phase: Speech["phase"] = "idle") => (
      <TestProductMeetingPanel capture={makeCapture({ phase: "listening", transcript })} speech={speechAt(phase)} location={LOCATION} />
    );
    const base = [openFin1, final1, { ...openFin1 }];
    const otherFinal = { text: "제가 대신 답변드리겠습니다", is_final: true, speaker: "2", language: "ko", translation_status: "original" as const };
    const otherFin = { text: "<fin>", is_final: true, speaker: "2", translation_status: "original" as const };

    const { rerender } = render(listening(emptySonioxTranscript()));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });
    rerender(listening(transcriptFrom([{ tokens: [openFin1] }])));
    rerender(listening(transcriptFrom([{ tokens: base }])));
    act(() => { fireEvent.keyDown(window, { code: "ShiftLeft" }); fireEvent.keyUp(window, { code: "ShiftLeft" }); });                  // broadcast attempt fails
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("번역하지 못했습니다");
    // The failure resets push-to-talk to idle (a new Left Shift is offered), it does not stick.
    expect(screen.getByLabelText("Push-to-Talk 상태").textContent).toContain("Left Shift로 내 송출 구간을 시작");
    expect(speak).not.toHaveBeenCalled();

    // Ordinary realtime translation still runs after the failure (fetch is attempted for the incoming row).
    await act(async () => { rerender(listening(transcriptFrom([{ tokens: [...base, otherFinal, otherFin] }]), "finished")); });
    await flush();
    expect(translateTexts()).toContain("제가 대신 답변드리겠습니다");
  });
});
