import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminConsole } from "@/components/AdminConsole";

const OWNER = { id: "owner", email: "owner@example.com", name: "Owner", role: "super_admin" as const, lastLoginAt: null };
const OPERATOR = { id: "op-1", email: "operator@example.com", name: "Woo Ram", role: "operator" as const, lastLoginAt: null };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubConsole(current: typeof OWNER | typeof OPERATOR) {
  let operators = [OWNER, OPERATOR];
  const deleted: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/admin/overview") return response({ currentOperator: current, customers: [], operators, audit: [] });
    const match = /^\/api\/admin\/operators\/([^/]+)$/u.exec(url);
    if (match && init?.method === "DELETE") {
      deleted.push(match[1]);
      operators = operators.filter((item) => item.id !== match[1]);
      return response({ ok: true });
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, deleted };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdminConsole operator management", () => {
  it("lets the super admin revoke an operator after confirming, and never offers it for the super admin row", async () => {
    const { deleted } = stubConsole(OWNER);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminConsole />);

    const revoke = await screen.findByRole("button", { name: "Woo Ram 운영자 해제" });
    expect(screen.queryByRole("button", { name: "Owner 운영자 해제" })).not.toBeInTheDocument();
    fireEvent.click(revoke);

    await waitFor(() => expect(deleted).toEqual(["op-1"]));
    await waitFor(() => expect(screen.queryByText("operator@example.com")).not.toBeInTheDocument());
    expect(screen.getByText("운영자를 해제했습니다.")).toBeInTheDocument();
  });

  it("does nothing when the confirmation is declined", async () => {
    const { deleted } = stubConsole(OWNER);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminConsole />);
    fireEvent.click(await screen.findByRole("button", { name: "Woo Ram 운영자 해제" }));
    expect(deleted).toEqual([]);
    expect(screen.getByText("operator@example.com")).toBeInTheDocument();
  });

  it("hides revocation from a plain operator", async () => {
    stubConsole(OPERATOR);
    render(<AdminConsole />);
    await screen.findByText("owner@example.com");
    expect(screen.queryByRole("button", { name: /운영자 해제/u })).not.toBeInTheDocument();
  });
});
