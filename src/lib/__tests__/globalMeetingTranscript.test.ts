import { describe, expect, it } from "vitest";

import {
  buildGlobalMeetingDefaultTitle,
  buildGlobalMeetingMinutes,
  buildGlobalMeetingTranscript,
  type GlobalMeetingLogEntry,
} from "@/lib/globalMeetingTranscript";

const ENTRIES: GlobalMeetingLogEntry[] = [
  { speaker: "Speaker 1", korean: "회의를 시작하겠습니다.", counterpart: "Let's start the meeting.", direction: "incoming" },
  { speaker: "Speaker 2", korean: "네, 좋습니다.", counterpart: "Yes, sounds good.", direction: "incoming" },
  { speaker: "Speaker 1 · Push-to-Talk", korean: "다음 주에 배포합시다.", counterpart: "Let's deploy next week.", direction: "outbound" },
];

describe("buildGlobalMeetingTranscript", () => {
  it("renders a bilingual, speaker-labeled transcript for every populated entry", () => {
    const transcript = buildGlobalMeetingTranscript(ENTRIES);
    expect(transcript).toContain("Speaker 1");
    expect(transcript).toContain("회의를 시작하겠습니다.");
    expect(transcript).toContain("Let's start the meeting.");
    expect(transcript).toContain("Speaker 1 · Push-to-Talk");
    expect(transcript).toContain("다음 주에 배포합시다.");
    // Ordering is preserved.
    expect(transcript.indexOf("회의를 시작")).toBeLessThan(transcript.indexOf("좋습니다"));
  });

  it("skips entries with no usable text and returns empty for an empty log", () => {
    expect(buildGlobalMeetingTranscript([])).toBe("");
    const sparse = buildGlobalMeetingTranscript([
      { speaker: "Speaker 1", korean: "", counterpart: "", direction: "incoming" },
    ]);
    expect(sparse).toBe("");
  });

  it("uses the selected input and translation language labels", () => {
    const transcript = buildGlobalMeetingTranscript(ENTRIES, {
      inputLanguageLabel: "일본어",
      targetLanguageLabel: "중국어",
    });
    expect(transcript).toContain("- 일본어:");
    expect(transcript).toContain("- 중국어:");
    expect(transcript).not.toContain("- 한국어:");
  });
});

describe("buildGlobalMeetingDefaultTitle", () => {
  it("derives an editable default title from meeting duration and conversation content", () => {
    expect(buildGlobalMeetingDefaultTitle({
      startedAt: "2026-07-30T01:00:00.000Z",
      endedAt: "2026-07-30T01:12:34.000Z",
      entries: ENTRIES,
    })).toBe("회의를 시작하겠습니다 · 13분 미팅");
  });

  it("uses a time-based fallback when the conversation is empty", () => {
    expect(buildGlobalMeetingDefaultTitle({
      startedAt: "2026-07-30T01:00:00.000Z",
      endedAt: "2026-07-30T01:00:00.000Z",
      entries: [],
    })).toContain("글로벌 미팅");
  });
});

describe("buildGlobalMeetingMinutes", () => {
  it("compiles a Korean-side minutes record with a header and one bullet per utterance", () => {
    const minutes = buildGlobalMeetingMinutes({
      title: "글로벌 미팅",
      startedAt: "2026-07-30T01:00:00.000Z",
      endedAt: "2026-07-30T01:12:34.000Z",
      inputLanguageLabel: "한국어",
      targetLanguageLabel: "영어",
      entries: ENTRIES,
    });
    expect(minutes).toContain("글로벌 미팅");
    expect(minutes).toContain("영어");
    expect(minutes).toContain("회의 시간: 13분");
    expect(minutes).toContain("입력 언어: 한국어");
    expect(minutes).toContain("번역할 언어: 영어");
    expect(minutes).toContain("- Speaker 1: 회의를 시작하겠습니다.");
    expect(minutes).toContain("- Speaker 2: 네, 좋습니다.");
    expect(minutes.trim().length).toBeGreaterThan(0);
  });
});
