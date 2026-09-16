import { describe, expect, it } from "vitest";

import { parseDocumentBlocks, renderRoomDocx, renderRoomPrintHtml } from "@/lib/roomDocuments";

const body = [
  "Vision 정기 미팅 · 통역 회의실 회의록",
  "일시: 2026-09-15 10:00",
  "",
  "주요 발화",
  "- 김민수: 다음 주 일정 확인 부탁드립니다.",
  "- Alex: Sure, I'll send it today.",
  "",
  "이것은 문장으로 끝나는 한 줄입니다.",
].join("\n");

describe("room document renderers", () => {
  it("splits blocks and treats a short non-bullet first line as the block heading", () => {
    expect(parseDocumentBlocks(body)).toEqual([
      { heading: "Vision 정기 미팅 · 통역 회의실 회의록", lines: ["일시: 2026-09-15 10:00"] },
      { heading: "주요 발화", lines: ["- 김민수: 다음 주 일정 확인 부탁드립니다.", "- Alex: Sure, I'll send it today."] },
      { heading: null, lines: ["이것은 문장으로 끝나는 한 줄입니다."] },
    ]);
  });

  it("produces a Word document (zip) whose XML carries the text", async () => {
    const buffer = await renderRoomDocx({ title: "회의록", body, language: "ko", generatedAt: "2026-09-15 12:00" });
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.byteLength).toBeGreaterThan(2_000);
  });

  it("renders a self-contained print page with escaped content and a print control", () => {
    const html = renderRoomPrintHtml({ title: "회의록 <테스트>", body, language: "ko", generatedAt: "2026-09-15 12:00" }, { printHint: "PDF로 저장" });
    expect(html).toContain("<title>회의록 &lt;테스트&gt;</title>");
    expect(html).toContain("<h2>주요 발화</h2>");
    expect(html).toContain("<li>Alex: Sure, I&#39;ll send it today.</li>");
    expect(html).toContain("window.print()");
    expect(html).toContain('lang="ko"');
    expect(html).not.toContain("<script src");
  });
});
