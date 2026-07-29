// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReleaseNotes } from "@/components/ReleaseNotes";
import type { ProductRelease } from "@/lib/releaseNotes";

const releases: ProductRelease[] = [
  { version: "1.14.0", date: "2026-07-29", title: "실시간 글로벌 미팅", changes: ["두 최상위 모드 추가", "그룹별 번역 창 추가"] },
  { version: "1.0.0", date: "2026-07-08", title: "AI NOTE 오픈소스 기준판", changes: ["기준판"] },
];

describe("product release history", () => {
  it("shows the current semantic version and every Markdown-backed release", () => {
    render(<ReleaseNotes releases={releases} />);
    expect(screen.getByRole("heading", { name: "릴리즈 노트" })).toBeInTheDocument();
    expect(screen.getByText("v1.14.0")).toBeInTheDocument();
    expect(screen.getByText("기준판 이후 1회 업데이트")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /v1\.14\.0 · 실시간 글로벌 미팅/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /v1\.0\.0 · AI NOTE 오픈소스 기준판/ })).toBeInTheDocument();
    expect(screen.getByText("이 목록은 프로젝트 루트의 RELEASES.md에서 읽습니다.", { exact: false })).toBeInTheDocument();
  });
});
