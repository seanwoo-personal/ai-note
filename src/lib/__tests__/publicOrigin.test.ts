import { afterEach, describe, expect, it, vi } from "vitest";

import { publicOrigin } from "@/lib/publicOrigin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicOrigin", () => {
  it("prefers the pinned APP_ORIGIN over whatever host the request arrived on", () => {
    vi.stubEnv("APP_ORIGIN", "https://note.example.com/");
    const request = new Request("http://127.0.0.1:3300/api/admin/operators/invite", { method: "POST" });
    expect(publicOrigin(request)).toBe("https://note.example.com");
  });

  it("falls back to the request origin locally, honoring a forwarded https only in cloud mode", () => {
    vi.stubEnv("APP_ORIGIN", "");
    const local = new Request("http://127.0.0.1:3000/x", { headers: { "x-forwarded-proto": "https" } });
    expect(publicOrigin(local)).toBe("http://127.0.0.1:3000");
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    expect(publicOrigin(local)).toBe("https://127.0.0.1:3000");
  });
});
