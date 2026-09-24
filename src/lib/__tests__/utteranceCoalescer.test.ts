import { describe, expect, it } from "vitest";

import { isSentenceTerminal, UtteranceCoalescer } from "@/lib/utteranceCoalescer";

function chunk(id: number, original: string, extra: Partial<{ translation: string; translationLanguage: string; key: string; language: string; at: number; codeSwitched: boolean }> = {}) {
  return {
    id,
    key: extra.key ?? "1",
    speakerLabel: extra.key ?? "1",
    language: extra.language ?? "ko",
    original,
    translation: extra.translation ?? "",
    translationLanguage: extra.translationLanguage ?? "en",
    codeSwitched: extra.codeSwitched ?? false,
    at: extra.at ?? 1_000 * id,
  };
}

describe("isSentenceTerminal", () => {
  it("accepts western and CJK sentence enders, also inside closing quotes", () => {
    for (const text of ["끝났습니다.", "Really?", "行きます。", "そうですか？", "좋아요!", "\"done.\"", "…"]) expect(isSentenceTerminal(text)).toBe(true);
  });
  it("rejects a breath-broken fragment", () => {
    for (const text of ["그래서 제가 어제", "and then we", "それで、", "다음 주에"]) expect(isSentenceTerminal(text)).toBe(false);
  });
});

describe("UtteranceCoalescer", () => {
  it("commits a complete sentence immediately", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 400 });
    expect(coalescer.push(chunk(1, "안녕하세요, 시작할까요?", { translation: "Hello, shall we start?" }))).toEqual([
      expect.objectContaining({ ids: [1], original: "안녕하세요, 시작할까요?", translation: "Hello, shall we start?", language: "ko", speakerLabel: "1" }),
    ]);
    expect(coalescer.pendingCount()).toBe(0);
  });

  it("holds a fragment and joins the continuation into one utterance with its translations", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 400 });
    expect(coalescer.push(chunk(1, "그래서 제가 어제", { translation: "So yesterday I" }))).toEqual([]);
    expect(coalescer.push(chunk(2, "고객사에 다녀왔습니다.", { translation: "visited the customer." }))).toEqual([
      expect.objectContaining({ ids: [1, 2], original: "그래서 제가 어제 고객사에 다녀왔습니다.", translation: "So yesterday I visited the customer." }),
    ]);
  });

  it("joins Japanese and Chinese fragments without inserting spaces", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 400 });
    coalescer.push(chunk(1, "それで、", { language: "ja", translation: "그래서,", translationLanguage: "ko" }));
    const [merged] = coalescer.push(chunk(2, "明日行きます。", { language: "ja", translation: "내일 갑니다.", translationLanguage: "ko" }));
    expect(merged.original).toBe("それで、明日行きます。");
    expect(merged.translation).toBe("그래서, 내일 갑니다.");
    coalescer.push(chunk(3, "그래서", { language: "ko", translation: "それで", translationLanguage: "ja" }));
    expect(coalescer.push(chunk(4, "내일 갑니다.", { language: "ko", translation: "明日行きます。", translationLanguage: "ja" }))[0].translation).toBe("それで明日行きます。");
  });

  it("flushes a stale fragment once the hold window passes", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 400 });
    coalescer.push(chunk(1, "다음 주에", { at: 10_000 }));
    expect(coalescer.flushStale(11_000)).toEqual([]);
    expect(coalescer.flushStale(11_600)).toEqual([expect.objectContaining({ ids: [1], original: "다음 주에" })]);
    expect(coalescer.nextDeadline()).toBeNull();
  });

  it("commits the pending fragment first when the speaker or the language changes", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 400 });
    coalescer.push(chunk(1, "제가 말씀드린 건", { key: "1" }));
    const commits = coalescer.push(chunk(2, "I see.", { key: "2", language: "en" }));
    expect(commits.map((item) => item.original)).toEqual(["제가 말씀드린 건", "I see."]);
    coalescer.push(chunk(3, "그리고 또", { key: "1" }));
    expect(coalescer.push(chunk(4, "we should", { key: "1", language: "en" })).map((item) => item.original)).toEqual(["그리고 또"]);
    expect(coalescer.pendingCount()).toBe(1);
  });

  it("caps a run-on buffer and marks code switching across merged chunks", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 20 });
    coalescer.push(chunk(1, "열 글자 정도 되는 말", { codeSwitched: true }));
    const [capped] = coalescer.push(chunk(2, "그리고 더 이어지는 말"));
    expect(capped.ids).toEqual([1, 2]);
    expect(capped.codeSwitched).toBe(true);
  });

  it("flushAll drains the pending buffer, e.g. when the microphone stops", () => {
    const coalescer = new UtteranceCoalescer({ holdMs: 1_500, maxChars: 400 });
    coalescer.push(chunk(1, "첫 번째", { at: 5_000 }));
    expect(coalescer.nextDeadline()).toBe(6_500);
    expect(coalescer.flushAll().map((item) => item.original)).toEqual(["첫 번째"]);
    expect(coalescer.pendingCount()).toBe(0);
    expect(coalescer.nextDeadline()).toBeNull();
  });
});
