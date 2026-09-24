import { describe, expect, it } from "vitest";

import { buildTranslationPrompt, cleanTranslation } from "@/lib/translation";

describe("buildTranslationPrompt", () => {
  it("keeps the plain single-utterance shape without context", () => {
    const prompt = buildTranslationPrompt("안녕하세요", "en");
    expect(prompt).toContain("into English");
    expect(prompt).toContain("<utterance>\n안녕하세요\n</utterance>");
    expect(prompt).not.toContain("<context>");
  });

  it("adds the preceding utterances as read-only context and asks for a natural continuation", () => {
    const prompt = buildTranslationPrompt("고객사에 다녀왔습니다.", "en", {
      context: [
        { speaker: "김민수", text: "그래서 제가 어제" },
        { speaker: "Alex", text: "Yes?" },
      ],
    });
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("김민수: 그래서 제가 어제");
    expect(prompt).toContain("Alex: Yes?");
    expect(prompt.indexOf("<context>")).toBeLessThan(prompt.indexOf("<utterance>"));
    expect(prompt).toMatch(/Translate only the utterance/u);
    expect(prompt).toMatch(/fragment|continu/iu);
    expect(prompt).toMatch(/dialect/iu);
  });

  it("strips fences and labels from model output", () => {
    expect(cleanTranslation("```text\nTranslation: Hello\n```")).toBe("Hello");
  });
});
