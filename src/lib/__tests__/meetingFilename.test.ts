// @vitest-environment node
import { describe, expect, it } from "vitest";

import { contentDispositionForMeeting } from "@/lib/meetingFilename";

describe("contentDispositionForMeeting", () => {
  it("uses the topic-bearing Korean title while keeping an ASCII fallback", () => {
    expect(contentDispositionForMeeting({
      title: "회의 2026-07-28 14:30 · 신제품 출시",
      fallbackId: "meeting-123",
      extension: "md",
    })).toBe(
      "attachment; filename=\"meeting-123.md\"; filename*=UTF-8''%ED%9A%8C%EC%9D%98%202026-07-28%2014_30%20%C2%B7%20%EC%8B%A0%EC%A0%9C%ED%92%88%20%EC%B6%9C%EC%8B%9C.md",
    );
  });

  it("removes path and control characters before writing the header", () => {
    const header = contentDispositionForMeeting({
      title: "주제/초안\\검토\r\nInjected: yes",
      fallbackId: "meeting-123",
      extension: "md",
    });
    expect(header).not.toMatch(/[\r\n]/u);
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe("주제_초안_검토 Injected_ yes.md");
  });
});
