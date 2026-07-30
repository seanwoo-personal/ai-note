import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({
  getConfiguredAdapter: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/services/llm", () => ({
  getConfiguredAdapter: llm.getConfiguredAdapter,
}));

import { POST } from "@/app/api/translate/route";

describe("POST /api/translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llm.getConfiguredAdapter.mockResolvedValue({ provider: "ollama", run: llm.run });
    llm.run.mockResolvedValue("こんにちは。よろしくお願いします。");
  });

  it("translates one bounded utterance into the requested meeting display language", async () => {
    const response = await POST(new Request("http://localhost:3100/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ text: "안녕하세요. 잘 부탁드립니다.", targetLanguage: "ja" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ translation: "こんにちは。よろしくお願いします。" });
    expect(llm.run).toHaveBeenCalledWith(expect.stringContaining("안녕하세요. 잘 부탁드립니다."));
    expect(llm.run).toHaveBeenCalledWith(expect.stringContaining("Japanese"));
  });

  it("instructs the model to preserve words that are already in the target language", async () => {
    await POST(new Request("http://localhost:3100/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ text: "회의를 시작합니다 okay", targetLanguage: "en" }),
    }));

    expect(llm.run).toHaveBeenCalledWith(expect.stringMatching(/already written in the target language/i));
  });

  it("rejects unsupported targets and oversized utterances without invoking a model", async () => {
    const unsupported = await POST(new Request("http://localhost:3100/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ text: "hello", targetLanguage: "xx" }),
    }));
    const oversized = await POST(new Request("http://localhost:3100/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ text: "a".repeat(4001), targetLanguage: "ko" }),
    }));

    expect(unsupported.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(llm.run).not.toHaveBeenCalled();
  });

  it("returns a truthful configuration error when no translation model is configured", async () => {
    llm.getConfiguredAdapter.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost:3100/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ text: "hello", targetLanguage: "ko" }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "translation_model_unavailable" } });
  });
});
