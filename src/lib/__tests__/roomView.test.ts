import { describe, expect, it } from "vitest";

import { applyRoomEvent, emptyRoomView, utterancePerspective, type RoomViewParticipant } from "@/lib/roomView";

const host: RoomViewParticipant = { role: "host", name: "김민수", language: "ko" };
const guest: RoomViewParticipant = { role: "guest", name: "Alex", language: "en" };

describe("room view reducer", () => {
  it("folds utterance, translation, attribution, participant, and ended events in seq order and ignores replays", () => {
    let state = emptyRoomView([host]);
    state = applyRoomEvent(state, { seq: 1, at: "2026-09-15T01:00:00.000Z", type: "participant", role: "guest", name: "Alex", language: "en", state: "joined" });
    state = applyRoomEvent(state, { seq: 2, at: "2026-09-15T01:00:01.000Z", type: "utterance", utteranceId: "u1", speaker: "host", origin: "host", sourceLanguage: "ko", original: "안녕하세요", speakerLabel: null, confidence: "high" });
    state = applyRoomEvent(state, { seq: 3, at: "2026-09-15T01:00:02.000Z", type: "translation", utteranceId: "u1", language: "en", text: "Hello" });
    const replayed = applyRoomEvent(state, { seq: 3, at: "2026-09-15T01:00:02.000Z", type: "translation", utteranceId: "u1", language: "en", text: "Hello again" });
    expect(replayed).toBe(state);
    state = applyRoomEvent(state, { seq: 4, at: "2026-09-15T01:00:03.000Z", type: "attribution", utteranceId: "u1", speaker: "guest" });
    state = applyRoomEvent(state, { seq: 5, at: "2026-09-15T01:00:04.000Z", type: "ended", endedAt: "2026-09-15T01:00:04.000Z" });

    expect(state.participants).toEqual([host, guest]);
    expect(state.utterances).toEqual([expect.objectContaining({ utteranceId: "u1", speaker: "guest", corrected: true, translations: { en: "Hello" } })]);
    expect(state.endedAt).toBe("2026-09-15T01:00:04.000Z");
    expect(state.lastSeq).toBe(5);
  });
});

describe("utterance perspective", () => {
  const mine = { utteranceId: "u1", seq: 1, at: "t", speaker: "host" as const, sourceLanguage: "ko", original: "안녕하세요", translations: { en: "Hello" }, confidence: "high" as const, corrected: false };
  const theirs = { utteranceId: "u2", seq: 2, at: "t", speaker: "guest" as const, sourceLanguage: "en", original: "Sure", translations: { ko: "물론이죠" }, confidence: "high" as const, corrected: false };

  it("shows the host their own original plus the English the guest received", () => {
    expect(utterancePerspective(mine, host, [host, guest])).toEqual({
      mine: true, speakerName: "김민수", primary: "안녕하세요", primaryLanguage: "ko",
      secondary: "Hello", secondaryLanguage: "en", secondaryPending: false,
    });
  });

  it("shows the host the guest's words in Korean with the English original as secondary", () => {
    expect(utterancePerspective(theirs, host, [host, guest])).toEqual({
      mine: false, speakerName: "Alex", primary: "물론이죠", primaryLanguage: "ko",
      secondary: "Sure", secondaryLanguage: "en", secondaryPending: false,
    });
  });

  it("shows the guest the mirrored view and marks pending translations", () => {
    const pending = { ...mine, translations: {} };
    expect(utterancePerspective(pending, guest, [host, guest])).toMatchObject({
      mine: false, primary: "안녕하세요", primaryLanguage: "ko", secondaryPending: true,
    });
    expect(utterancePerspective(theirs, guest, [host, guest])).toMatchObject({
      mine: true, primary: "Sure", secondary: "물론이죠", secondaryLanguage: "ko", secondaryPending: false,
    });
  });

  it("needs no translation line when both sides share the utterance language", () => {
    const shared = { ...mine, sourceLanguage: "en", original: "Let's start", translations: {} };
    expect(utterancePerspective(shared, host, [host, guest])).toMatchObject({ mine: true, secondary: null, secondaryPending: false });
  });
});
