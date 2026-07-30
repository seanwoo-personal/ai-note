import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LivePage from "@/app/live/page";

vi.mock("@/components/SonioxWorkspaceClient", () => ({
  SonioxWorkspaceClient: () => <main>실시간 도구</main>,
}));

describe("Live tools page", () => {
  it("renders the realtime workspace client", () => {
    render(<LivePage />);
    expect(screen.getByRole("main")).toHaveTextContent("실시간 도구");
  });
});
