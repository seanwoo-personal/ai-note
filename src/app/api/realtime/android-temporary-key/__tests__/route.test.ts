import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/realtime/android-temporary-key/route";

const ORIGIN = "http://127.0.0.1:3000";

function request(): Request {
  return new Request(`${ORIGIN}/api/realtime/android-temporary-key`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ service: "stt" }),
  });
}

afterEach(() => {
  delete process.env.SONIOX_API_KEY;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Android development temporary-key bridge", () => {
  it("mints a single-use key only while the local server is in development mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.SONIOX_API_KEY = "server-only-long-lived-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      api_key: "android-temporary-key",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiKey: "android-temporary-key" });
  });

  it("is disabled in production even when Soniox is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SONIOX_API_KEY = "server-only-long-lived-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
