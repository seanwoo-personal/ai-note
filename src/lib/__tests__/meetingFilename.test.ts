// @vitest-environment node
import { describe, expect, it } from "vitest";

import { contentDispositionForMeeting, meetingDownloadBaseName } from "@/lib/meetingFilename";
import { automaticMeetingTitle } from "@/lib/status";

// `YYYYMMDD_HHMMSS` in the product's LOCAL wall-clock — the same semantics as
// src/lib/status.ts automaticMeetingTitle (getFullYear/getHours…), NOT UTC. Deriving
// the expectation this way keeps every assertion correct under any host timezone
// (CI in UTC or the Asia/Seoul dev box) while still pinning local semantics.
function localCompact(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function utcCompact(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

describe("meetingDownloadBaseName", () => {
  const startedAt = "2026-07-05T13:30:00.000Z";
  const TS = localCompact(startedAt);

  it("D1: formats the START time in product-local wall-clock (matching status.ts), never UTC", () => {
    const base = meetingDownloadBaseName({ startedAt, summary: "kickoff", fallback: "m" });
    expect(base.slice(0, 15)).toBe(TS);
    // Whenever the host offset is non-zero for this instant, local != UTC, so a UTC
    // implementation (getUTC*) is caught here. On the Asia/Seoul (+9) reference box
    // this is 20260705_223000, not 20260705_133000.
    if (localCompact(startedAt) !== utcCompact(startedAt)) {
      expect(base.slice(0, 15)).not.toBe(utcCompact(startedAt));
    }
    // The compact date/time must agree with the H1 automatic title (also local).
    const title = automaticMeetingTitle(startedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date(startedAt);
    expect(title).toContain(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
  });

  it("D1: repeated calls with the same start are byte-stable (captured once)", () => {
    const first = meetingDownloadBaseName({ startedAt, summary: "kickoff", fallback: "m" });
    const second = meetingDownloadBaseName({ startedAt, summary: "kickoff", fallback: "m" });
    expect(second).toBe(first);
    expect(first.startsWith(`${TS} `)).toBe(true);
  });

  it("formats the meeting START time then exactly one space then the one-sentence summary", () => {
    const base = meetingDownloadBaseName({
      startedAt,
      summary: "딜러십 재고 견적 기능을 마무리하고 이번 주 온보딩 개선에 착수한다",
      fallback: "m-123",
    });
    expect(base).toBe(`${TS} 딜러십 재고 견적 기능을 마무리하고 이번 주 온보딩 개선에 착수한다`);
    // Exactly one literal space between the timestamp and the summary.
    expect(base).toMatch(/^\d{8}_\d{6} \S/u);
    expect(base.slice(0, 16)).toBe(`${TS} `);
  });

  it("uses a deterministic safe fallback when the summary is absent or blank", () => {
    expect(meetingDownloadBaseName({ startedAt, summary: null, fallback: "m-123" }))
      .toBe(`${TS} m-123`);
    expect(meetingDownloadBaseName({ startedAt, summary: "   ", fallback: "m-123" }))
      .toBe(`${TS} m-123`);
    expect(meetingDownloadBaseName({ startedAt, summary: "", fallback: "" }))
      .toBe(`${TS} meeting`);
  });

  it("normalizes reserved/control/newline/excess whitespace in the summary", () => {
    const base = meetingDownloadBaseName({
      startedAt,
      summary: "주제/초안\\검토\r\n  다   음",
      fallback: "m",
    });
    expect(base).not.toMatch(/[\r\n]/u);
    expect(base).toBe(`${TS} 주제_초안_검토 다 음`);
  });

  it("falls back to a zeroed timestamp for an unparseable start time", () => {
    expect(meetingDownloadBaseName({ startedAt: "not-a-date", summary: "x", fallback: "m" }))
      .toBe("00000000_000000 x");
  });

  it("composes into a Content-Disposition header that preserves the extension", () => {
    const header = contentDispositionForMeeting({
      title: meetingDownloadBaseName({ startedAt, summary: "신제품 출시", fallback: "m-1" }),
      fallbackId: "m-1",
      extension: "md",
    });
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe(`${TS} 신제품 출시.md`);
  });
});

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
