import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accountSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accountSession")>()),
  resolveRequestSession: vi.fn(),
}));
vi.mock("@/lib/guestSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/guestSession")>()),
  resolveGuestSession: vi.fn(),
}));

import { resolveRequestSession } from "@/lib/accountSession";
import { resolveGuestSession } from "@/lib/guestSession";
import { middleware } from "@/middleware";

const mockedSession = vi.mocked(resolveRequestSession);
const mockedGuest = vi.mocked(resolveGuestSession);
const HOST = "181e8f1f-80d5-464d-83c1-e7ad416f90e3";

describe("guest room sessions in middleware", () => {
  beforeEach(() => {
    mockedSession.mockResolvedValue(null);
    mockedGuest.mockResolvedValue(null);
  });

  it("lets a guest session through a room API with the host tenant and its single room pinned", async () => {
    mockedGuest.mockResolvedValue({ hostAccountId: HOST, meetingId: "room-1", name: "Alex", language: "en", expiresAt: "2099-01-01T00:00:00.000Z" });
    const request = new NextRequest("https://example.test/api/rooms/room-1/events", {
      headers: { cookie: "vision_guest_session=guest-token", "x-vision-guest-room": "room-forged", "x-vision-account-id": "forged" },
    });

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-request-x-vision-account-id")).toBe(HOST);
    expect(response.headers.get("x-middleware-request-x-vision-account-role")).toBe("guest");
    expect(response.headers.get("x-middleware-request-x-vision-guest-room")).toBe("room-1");
  });

  it("rejects a guest session on ordinary customer APIs and pages", async () => {
    mockedGuest.mockResolvedValue({ hostAccountId: HOST, meetingId: "room-1", name: "Alex", language: "en", expiresAt: "2099-01-01T00:00:00.000Z" });
    const api = await middleware(new NextRequest("https://example.test/api/meetings", { headers: { cookie: "vision_guest_session=guest-token" } }));
    expect(api.status).toBe(401);
    const page = await middleware(new NextRequest("https://example.test/", { headers: { cookie: "vision_guest_session=guest-token" } }));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
  });

  it("returns 401 on a room API without any session", async () => {
    const response = await middleware(new NextRequest("https://example.test/api/rooms/room-1"));
    expect(response.status).toBe(401);
  });

  it("strips a forged guest-room header from a customer request", async () => {
    mockedSession.mockResolvedValue({
      account: { id: HOST, role: "customer", passwordChangeRequired: false },
      expiresAt: "2099-01-01T00:00:00.000Z",
    } as Awaited<ReturnType<typeof resolveRequestSession>>);
    const response = await middleware(new NextRequest("https://example.test/api/rooms/room-1", {
      headers: { cookie: "vision_customer_session=x", "x-vision-guest-room": "room-forged" },
    }));
    expect(response.headers.get("x-middleware-request-x-vision-account-role")).toBe("customer");
    expect(response.headers.get("x-middleware-override-headers")).not.toContain("x-vision-guest-room");
  });

  it("keeps the join page and join API public", async () => {
    const page = await middleware(new NextRequest("https://example.test/join/some-token"));
    expect(page.headers.get("x-middleware-next")).toBe("1");
    const api = await middleware(new NextRequest("https://example.test/api/rooms/join/some-token", { method: "POST" }));
    expect(api.headers.get("x-middleware-next")).toBe("1");
  });
});
