// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterAdapter } from "@/services/llm/openRouter";

const API_KEY = "openrouter-test-key";

describe("OpenRouterAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", API_KEY);
    fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"oneLine":"요약"}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("요약 작업은 품질 우선 저비용 모델 체인과 개인정보 보호 라우팅을 사용한다", async () => {
    const output = await new OpenRouterAdapter({ provider: "openrouter" })
      .run("회의를 요약해 줘", { json: true, task: "summary" });

    expect(output).toBe('{"oneLine":"요약"}');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body as string);
    expect(body.models).toEqual([
      "google/gemini-3.1-flash-lite",
      "google/gemini-2.5-flash-lite",
      "mistralai/mistral-small-2603",
    ]);
    expect(body.provider).toEqual({
      sort: "price",
      zdr: true,
      data_collection: "deny",
    });
    expect(body.messages).toEqual([{ role: "user", content: "회의를 요약해 줘" }]);
  });

  it("전사 교정과 번역은 최저가 모델을 먼저 사용한다", async () => {
    const adapter = new OpenRouterAdapter({ provider: "openrouter" });
    await adapter.run("전사를 교정해 줘", { task: "transcript" });
    await adapter.run("번역해 줘", { task: "translation" });

    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.models).toEqual([
        "google/gemini-2.5-flash-lite",
        "mistralai/mistral-small-2603",
        "google/gemini-3.1-flash-lite",
      ]);
    }
  });

  it("사용자가 지정한 모델을 체인의 첫 모델로 올리고 중복을 제거한다", async () => {
    const adapter = new OpenRouterAdapter({
      provider: "openrouter",
      model: "mistralai/mistral-small-2603",
    });
    await adapter.run("p", { task: "summary" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.models).toEqual([
      "mistralai/mistral-small-2603",
      "google/gemini-3.1-flash-lite",
      "google/gemini-2.5-flash-lite",
    ]);
  });

  it("공급자 응답 본문이나 키를 노출하지 않고 실패한다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private-provider-detail", { status: 401 }));
    await expect(new OpenRouterAdapter({ provider: "openrouter" }).run("p"))
      .rejects.toThrow("openrouter_status_401");
  });

  it("키 상태 API를 실제 호출해 연결을 검사한다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const health = await new OpenRouterAdapter({ provider: "openrouter" }).health();

    expect(health.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: { authorization: `Bearer ${API_KEY}` },
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(health.detail).not.toContain(API_KEY);
  });

  it("키가 없으면 네트워크 호출 없이 설정 방법을 안내한다", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const health = await new OpenRouterAdapter({ provider: "openrouter" }).health();

    expect(health.ok).toBe(false);
    expect(health.detail).toContain("OPENROUTER_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
