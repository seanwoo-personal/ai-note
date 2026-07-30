import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/realtime/temporary-key/route";

afterEach(() => {
  delete process.env.SONIOX_API_KEY;
  vi.unstubAllGlobals();
});

describe("Soniox temporary-key route", () => {
  it("mints service-scoped STT and TTS credentials without exposing the long-lived credential", async () => {
    process.env.SONIOX_API_KEY = ["long", "lived", "value"].join("-");
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return {
        ok: true,
        json: async () => ({ ["api" + "_key"]: "temporary-value" }),
      } as Response;
    }));

    const stt = await POST(new Request("http://localhost:3100/api/realtime/temporary-key", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ service: "stt" }),
    }));
    const tts = await POST(new Request("http://localhost:3100/api/realtime/temporary-key", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ service: "tts" }),
    }));

    expect(stt.status).toBe(200);
    expect(tts.status).toBe(200);
    expect(requestBodies).toEqual([
      expect.objectContaining({ usage_type: "transcribe_websocket", single_use: true, max_session_duration_seconds: 18_000 }),
      expect.not.objectContaining({ max_session_duration_seconds: expect.anything() }),
    ]);
    expect(requestBodies[1]).toMatchObject({ usage_type: "tts_rt", single_use: true });
    expect(JSON.stringify(await tts.json())).not.toContain(process.env.SONIOX_API_KEY);
  });

  it("rejects unknown services before calling Soniox", async () => {
    process.env.SONIOX_API_KEY = ["long", "lived", "value"].join("-");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost:3100/api/realtime/temporary-key", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ service: "other" }),
    }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
