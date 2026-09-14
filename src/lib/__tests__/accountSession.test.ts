// @vitest-environment node
import { NextResponse } from "next/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSessionCookie, setSessionCookie } from "@/lib/accountSession";

describe("account session cookie transport", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps loopback HTTP cookies usable in an optimized local build", () => {
    const response = NextResponse.json({ ok: true });
    setSessionCookie(
      response,
      "customer",
      "opaque-token",
      "2026-08-05T00:00:00.000Z",
      new Request("http://localhost:3100/api/auth/login"),
    );

    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("marks HTTPS session and clearing cookies Secure", () => {
    const request = new Request("https://note.example.jp/api/auth/login");
    const session = NextResponse.json({ ok: true });
    setSessionCookie(session, "admin", "opaque-token", "2026-08-05T00:00:00.000Z", request);
    expect(session.headers.get("set-cookie")).toContain("Secure");

    const clearing = NextResponse.json({ ok: true });
    clearSessionCookie(clearing, "admin", request);
    expect(clearing.headers.get("set-cookie")).toContain("Secure");
  });

  it("marks cookies Secure behind the trusted cloud HTTPS proxy", () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    const request = new Request("http://app:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, "customer", "opaque-token", "2026-08-05T00:00:00.000Z", request);
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
