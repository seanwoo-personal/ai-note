import { describe, expect, it } from "vitest";

import { classifyAccountRoute } from "@/lib/accountAccessPolicy";

describe("account route policy", () => {
  it("leaves only the explicit application and login surfaces public", () => {
    for (const path of [
      "/login",
      "/signup",
      "/signup/success",
      "/forgot-password",
      "/admin/login",
      "/admin/mfa-reset",
      "/admin/setup",
      "/admin/accept",
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/password/forgot",
      "/api/auth/session",
      "/api/realtime/android-temporary-key",
      "/api/admin/login",
      "/api/admin/mfa-reset",
      "/api/admin/bootstrap",
      "/api/admin/operators/accept",
    ]) expect(classifyAccountRoute(path)).toBe("public");
  });

  it("separates customer product routes from operator routes", () => {
    expect(classifyAccountRoute("/")).toBe("customer");
    expect(classifyAccountRoute("/live")).toBe("customer");
    expect(classifyAccountRoute("/api/meetings")).toBe("customer");
    expect(classifyAccountRoute("/password/change")).toBe("customer");
    expect(classifyAccountRoute("/api/auth/password/change")).toBe("customer");
    expect(classifyAccountRoute("/admin")).toBe("admin");
    expect(classifyAccountRoute("/api/admin/overview")).toBe("admin");
  });

  it("does not apply account auth to framework and static assets", () => {
    expect(classifyAccountRoute("/_next/static/chunk.js")).toBe("asset");
    expect(classifyAccountRoute("/fonts/SUIT/SUIT-Medium.woff2")).toBe("asset");
    expect(classifyAccountRoute("/brand/vision-logo.svg")).toBe("asset");
    expect(classifyAccountRoute("/favicon.ico")).toBe("asset");
  });
});

describe("streaming finalize path", () => {
  it("matches only the raw audio finalize route that middleware passes through untouched", async () => {
    const { isStreamingFinalizePath } = await import("@/lib/accountAccessPolicy");
    expect(isStreamingFinalizePath("/api/meetings/meeting-1/finalize")).toBe(true);
    expect(isStreamingFinalizePath("/api/meetings/550e8400-e29b-41d4-a716-446655440000/finalize")).toBe(true);
    expect(isStreamingFinalizePath("/api/meetings/meeting-1/finalize/extra")).toBe(false);
    expect(isStreamingFinalizePath("/api/meetings/meeting-1")).toBe(false);
    expect(isStreamingFinalizePath("/api/meetings")).toBe(false);
    expect(isStreamingFinalizePath("/api/meetings/a/b/finalize")).toBe(false);
  });
});

describe("interpreter room surfaces", () => {
  it("keeps the join page and join API public while room APIs accept host or guest sessions", () => {
    expect(classifyAccountRoute("/join/abc123")).toBe("public");
    expect(classifyAccountRoute("/api/rooms/join/abc123")).toBe("public");
    expect(classifyAccountRoute("/api/rooms")).toBe("customer");
    expect(classifyAccountRoute("/api/rooms/room-1")).toBe("room");
    expect(classifyAccountRoute("/api/rooms/room-1/events")).toBe("room");
    expect(classifyAccountRoute("/api/realtime/temporary-key")).toBe("room");
    expect(classifyAccountRoute("/api/translate")).toBe("room");
    expect(classifyAccountRoute("/rooms/room-1")).toBe("customer");
  });
});
