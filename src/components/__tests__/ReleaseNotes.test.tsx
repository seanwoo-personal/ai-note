// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReleaseNotes } from "@/components/ReleaseNotes";
import {
  CURRENT_PRODUCT_VERSION,
  PRODUCT_RELEASES,
  PRODUCT_UPDATE_COUNT,
} from "@/lib/releases";

describe("release notes", () => {
  it("counts user-facing milestones from the AI NOTE 1.0 baseline", () => {
    expect(PRODUCT_RELEASES.at(-1)?.version).toBe("1.0");
    expect(CURRENT_PRODUCT_VERSION).toBe("1.13");
    expect(PRODUCT_UPDATE_COUNT).toBe(13);
  });

  it("shows the current version and every historical release in settings copy", () => {
    render(<ReleaseNotes />);
    expect(screen.getByRole("heading", { name: "릴리즈 노트" })).toBeInTheDocument();
    expect(screen.getByText("v1.13")).toBeInTheDocument();
    expect(screen.getByText("기준판 이후 13회 업데이트")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /v1\.13 · 언어별 화자 동시 통역/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /v1\.0 · AI NOTE 오픈소스 기준판/ })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(PRODUCT_RELEASES.length);
  });
});
