// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the subprocess helper so run() never shells out; codex's structured
// contract is the `--json` JSONL event stream, from which we salvage the final
// assistant message. The orchestrator's tolerant extractor then handles any
// fences/prose left inside that message.
vi.mock("@/services/llm/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/llm/exec")>();
  return { ...actual, runProcess: vi.fn(async () => ({ stdout: "", stderr: "" })) };
});

import { CodexCliAdapter } from "@/services/llm/codexCli";
import { LLM_GENERATION_TIMEOUT_MS, runProcess } from "@/services/llm/exec";

const runProcessMock = vi.mocked(runProcess);

describe("CodexCliAdapter.run — structured JSONL salvage", () => {
  beforeEach(() => runProcessMock.mockClear());

  it("emits the --json event stream and salvages the final assistant message", async () => {
    const envelope = '{"type":"final","answerSegments":[],"limitationFlags":[]}';
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ msg: { type: "agent_message", text: "검색을 진행합니다" } }),
      JSON.stringify({ type: "item.completed", item: { text: envelope } }),
      "",
    ].join("\n");
    runProcessMock.mockResolvedValueOnce({ stdout, stderr: "" });

    const out = await new CodexCliAdapter({ provider: "codex-cli" }).run("p");

    const args = runProcessMock.mock.calls[0]?.[1] ?? [];
    expect(args).toContain("--json");
    const opts = runProcessMock.mock.calls[0]?.[2];
    expect(opts?.stdin).toBe("p");
    expect(opts?.timeoutMs).toBe(LLM_GENERATION_TIMEOUT_MS);
    // The salvaged final message is handed on verbatim for tolerant parsing.
    expect(out).toBe(envelope);
  });

  it("hands back raw stdout when no assistant message can be salvaged", async () => {
    runProcessMock.mockResolvedValueOnce({ stdout: "완전히 비정형 출력", stderr: "" });

    const out = await new CodexCliAdapter({ provider: "codex-cli" }).run("p");

    expect(out).toBe("완전히 비정형 출력");
  });

  it("passes an exact custom model only when configured and never runs a model catalog command", async () => {
    await new CodexCliAdapter({ provider: "codex-cli", model: "custom-codex-model" }).run("p");
    const args = runProcessMock.mock.calls[0]?.[1] ?? [];
    expect(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2)).toEqual([
      "-m",
      "custom-codex-model",
    ]);
    expect(args.join(" ")).not.toMatch(/debug models|models list/);

    runProcessMock.mockClear();
    await new CodexCliAdapter({ provider: "codex-cli" }).run("p");
    expect(runProcessMock.mock.calls[0]?.[1]).not.toContain("-m");
  });
});

describe("CodexCliAdapter.health — binary detection only", () => {
  beforeEach(() => runProcessMock.mockClear());

  it("uses only codex --version and reports detection without claiming authentication", async () => {
    runProcessMock.mockResolvedValueOnce({ stdout: "codex 1.0", stderr: "" });
    const health = await new CodexCliAdapter({ provider: "codex-cli" }).health();
    expect(runProcessMock).toHaveBeenCalledWith(
      "codex",
      ["--version"],
      expect.objectContaining({ timeoutMs: 15_000 }),
    );
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("첫 요약에서 확인");
    expect(health.detail).not.toMatch(/codex/i);
  });

  it("returns an actionable static message for a missing binary", async () => {
    runProcessMock.mockRejectedValueOnce(
      Object.assign(new Error("private spawn output"), { code: "ENOENT" }),
    );
    const health = await new CodexCliAdapter({ provider: "codex-cli" }).health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("API 키");
    expect(health.detail).not.toMatch(/codex/i);
  });
});

describe("CodexCliAdapter — API-key mode (customer machines without the CLI)", () => {
  const KEY = "sk-test-not-a-real-key";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runProcessMock.mockClear();
    vi.stubEnv("CODEX_API_KEY", KEY);
    fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"oneLine":"요약"}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("runs the prompt through the HTTPS API with a bearer key and never shells out", async () => {
    const out = await new CodexCliAdapter({ provider: "codex-cli" }).run("요약해 줘");

    expect(out).toBe('{"oneLine":"요약"}');
    expect(runProcessMock).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: "user", content: "요약해 줘" }]);
    expect(body.model).toBeTruthy();
  });

  it("honors a custom model and surfaces opaque errors without the response body", async () => {
    await new CodexCliAdapter({ provider: "codex-cli", model: "custom-api-model" }).run("p");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).model)
      .toBe("custom-api-model");

    fetchMock.mockResolvedValueOnce(new Response("{\"secret\":\"internal provider detail\"}", { status: 401 }));
    await expect(new CodexCliAdapter({ provider: "codex-cli" }).run("p"))
      .rejects.toThrow("summary_api_status_401");
  });

  it("reports healthy on key presence alone without network or subprocess calls", async () => {
    const health = await new CodexCliAdapter({ provider: "codex-cli" }).health();
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("API 키");
    expect(health.detail).not.toContain(KEY);
    expect(runProcessMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
