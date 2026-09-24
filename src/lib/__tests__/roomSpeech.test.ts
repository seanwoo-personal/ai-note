import { describe, expect, it } from "vitest";

import { selectSpeechJobs } from "@/lib/roomSpeech";
import type { RoomViewUtterance } from "@/lib/roomView";

function utterance(partial: Partial<RoomViewUtterance> & Pick<RoomViewUtterance, "utteranceId" | "seq" | "speaker" | "sourceLanguage">): RoomViewUtterance {
  return { at: "2026-09-25T00:00:00.000Z", original: "…", translations: {}, confidence: "high", corrected: false, ...partial };
}

describe("selectSpeechJobs", () => {
  const me = { role: "guest" as const, language: "en" as const };

  it("voices only the other seat's foreign-language utterances that already have my translation, in order", () => {
    const jobs = selectSpeechJobs([
      utterance({ utteranceId: "u2", seq: 3, speaker: "host", sourceLanguage: "ko", translations: { en: "Second" } }),
      utterance({ utteranceId: "u1", seq: 1, speaker: "host", sourceLanguage: "ko", translations: { en: "First" } }),
      utterance({ utteranceId: "mine", seq: 2, speaker: "guest", sourceLanguage: "en", translations: { ko: "내 말" } }),
      utterance({ utteranceId: "same", seq: 4, speaker: "host", sourceLanguage: "en", original: "Already English" }),
      utterance({ utteranceId: "pending", seq: 5, speaker: "host", sourceLanguage: "ko" }),
    ], me, new Set());
    expect(jobs).toEqual([
      { utteranceId: "u1", text: "First", language: "en" },
      { utteranceId: "u2", text: "Second", language: "en" },
    ]);
  });

  it("never voices an utterance twice, so a refined translation does not replay", () => {
    const list = [utterance({ utteranceId: "u1", seq: 1, speaker: "host", sourceLanguage: "ko", translations: { en: "Refined" } })];
    expect(selectSpeechJobs(list, me, new Set(["u1"]))).toEqual([]);
  });
});
