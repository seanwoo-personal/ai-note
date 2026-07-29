import { describe, expect, it } from "vitest";

import { parseReleaseNotesMarkdown } from "@/lib/releaseNotes";

describe("release notes markdown", () => {
  it("parses newest-first semantic versions and their complete bullet history", () => {
    const releases = parseReleaseNotesMarkdown(`# 릴리즈 노트

## 1.14.0
**2026-07-29 · 글로벌 미팅**
- 첫 번째 변경
- 두 번째 변경

## 1.13.0
**2026-07-28 · 이전 버전**
- 이전 변경
`);

    expect(releases).toEqual([
      { version: "1.14.0", date: "2026-07-29", title: "글로벌 미팅", changes: ["첫 번째 변경", "두 번째 변경"] },
      { version: "1.13.0", date: "2026-07-28", title: "이전 버전", changes: ["이전 변경"] },
    ]);
  });

  it("rejects malformed or duplicated release sections instead of showing partial history", () => {
    expect(() => parseReleaseNotesMarkdown("## 1.14.0\n- 제목이 없음")).toThrow(/release metadata/i);
    expect(() => parseReleaseNotesMarkdown("## 1.14.0\n**2026-07-29 · A**\n- x\n## 1.14.0\n**2026-07-29 · B**\n- y")).toThrow(/duplicate/i);
  });
});
