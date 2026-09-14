import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accountSession", () => ({
  resolveRequestSession: vi.fn(),
}));

import { resolveRequestSession } from "@/lib/accountSession";
import { middleware } from "@/middleware";

const mockedSession = vi.mocked(resolveRequestSession);

describe("streaming finalize middleware", () => {
  beforeEach(() => {
    mockedSession.mockResolvedValue({
      account: {
        id: "181e8f1f-80d5-464d-83c1-e7ad416f90e3",
        role: "customer",
        passwordChangeRequired: false,
      },
      expiresAt: "2099-01-01T00:00:00.000Z",
    } as Awaited<ReturnType<typeof resolveRequestSession>>);
  });

  it("does not clone or override the streaming upload request headers", async () => {
    const request = new NextRequest(
      "https://example.test/api/meetings/meeting-1/finalize?durationMs=1",
      {
        method: "POST",
        headers: {
          cookie: "vision_customer_session=test",
          origin: "https://example.test",
        },
        body: new Uint8Array([1, 2, 3]),
      },
    );

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-override-headers")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-vision-account-id")).toBeNull();
  });

  it("still forwards the trusted account identity for ordinary product APIs", async () => {
    const request = new NextRequest("https://example.test/api/meetings?view=global");

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-override-headers")).toContain("x-vision-account-id");
    expect(response.headers.get("x-middleware-request-x-vision-account-id"))
      .toBe("181e8f1f-80d5-464d-83c1-e7ad416f90e3");
  });
});
