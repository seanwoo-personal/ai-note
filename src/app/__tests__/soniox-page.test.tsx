import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SonioxPage from "@/app/soniox/page";

vi.mock("@/components/SonioxWorkspaceClient", () => ({
  SonioxWorkspaceClient: () => <main>Soniox 도구</main>,
}));

describe("Soniox page", () => {
  it("renders the Soniox workspace client", () => {
    render(<SonioxPage />);
    expect(screen.getByRole("main")).toHaveTextContent("Soniox 도구");
  });
});
