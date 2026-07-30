// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/realtime/temporary-key/route";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_LONG_LIVED_KEY = ["test", "long", "lived"].join("-");

function request(method: "GET" | "POST", origin = ORIGIN): Request {
  return new Request(`${origin}/api/realtime/temporary-key`, {
    method,
    headers: {
      host: new URL(origin).host,
      ...(method === "POST" ? { origin } : {}),
    },
  });
}

afterEach(() => {
  delete process.env.SONIOX_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/realtime/temporary-key", () => {
  it("runs the local guard before reading configuration", async () => {
    const deniedRequest = request("POST", "http://evil.test");
    const env = vi.spyOn(process, "env", "get").mockImplementation(() => {
      throw new Error("configuration must not be read");
    });
    try {
      const response = await POST(deniedRequest);
      expect(response.status).toBe(403);
      expect(env).not.toHaveBeenCalled();
    } finally {
      env.mockRestore();
    }
  });

  it("reports whether Soniox is configured without exposing the key", async () => {
    process.env.SONIOX_API_KEY = TEST_LONG_LIVED_KEY;
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true });
  });

  it("mints a single-use temporary transcription key and only returns that key", async () => {
    process.env.SONIOX_API_KEY = TEST_LONG_LIVED_KEY;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      api_key: "temporary-secret",
      expires_at: "2026-07-27T10:00:00Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ apiKey: "temporary-secret" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.soniox.com/v1/auth/temporary-api-key",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_LONG_LIVED_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          usage_type: "transcribe_websocket",
          expires_in_seconds: 60,
          single_use: true,
          max_session_duration_seconds: 18_000,
        }),
      }),
    );
  });

  it("fails closed when the long-lived key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("SONIOX_API_KEY");
  });
});
