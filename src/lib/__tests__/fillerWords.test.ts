import { describe, expect, it } from "vitest";

import { stripFillerWords } from "@/lib/fillerWords";

describe("stripFillerWords", () => {
  it("drops standalone Korean hesitation sounds", () => {
    expect(stripFillerWords("음 그래서 내일 회의를 하죠")).toBe("그래서 내일 회의를 하죠");
    expect(stripFillerWords("어 저희가 준비하겠습니다")).toBe("저희가 준비하겠습니다");
    expect(stripFillerWords("그래서 음 내일 봅시다")).toBe("그래서 내일 봅시다");
  });

  it("drops elongated and repeated hesitations with their trailing punctuation", () => {
    expect(stripFillerWords("으음... 그건 좀 어렵습니다")).toBe("그건 좀 어렵습니다");
    expect(stripFillerWords("어어 잠시만요")).toBe("잠시만요");
    expect(stripFillerWords("아, 알겠습니다")).toBe("알겠습니다");
  });

  it("drops English, Japanese, and Chinese fillers too", () => {
    expect(stripFillerWords("um I think we should ship")).toBe("I think we should ship");
    expect(stripFillerWords("Well uh maybe not today")).toBe("Well maybe not today");
    expect(stripFillerWords("えーと 明日にしましょう")).toBe("明日にしましょう");
    expect(stripFillerWords("うーん それは難しいです")).toBe("それは難しいです");
    expect(stripFillerWords("呃 我们明天再说")).toBe("我们明天再说");
  });

  it("never strips real words that merely start with a filler syllable", () => {
    // These are the words a careless filler list destroys. 어제/아니요/그/뭐/저기
    // carry meaning; only a standalone hesitation token may be removed.
    for (const sentence of [
      "어제 회의는 좋았습니다",
      "아니요 그건 아닙니다",
      "그 사람이 뭐라고 했죠",
      "저기 앉으시면 됩니다",
      "음악을 준비했습니다",
      "umbrella and another item",
      "明日の会議",
    ]) {
      expect(stripFillerWords(sentence), sentence).toBe(sentence);
    }
  });

  it("keeps the utterance when it is nothing but fillers", () => {
    // Broadcasting silence is worse than broadcasting a hesitation: if the whole
    // turn is filler there is nothing else to say, so leave it untouched.
    expect(stripFillerWords("음")).toBe("음");
    expect(stripFillerWords("어 음...")).toBe("어 음...");
  });

  it("normalizes the whitespace it leaves behind", () => {
    expect(stripFillerWords("음   그래서    갑시다")).toBe("그래서 갑시다");
    expect(stripFillerWords("  어 시작합니다  ")).toBe("시작합니다");
  });

  it("returns empty and blank input unchanged", () => {
    expect(stripFillerWords("")).toBe("");
    expect(stripFillerWords("   ")).toBe("   ");
  });
});
