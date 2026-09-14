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
