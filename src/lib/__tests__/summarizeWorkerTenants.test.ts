// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const summarizeMocks = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; root: string | null }>,
}));

vi.mock("@/lib/summarize", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/summarize")>();
  const tenant = await import("@/lib/tenantDataContext");
  return {
    ...original,
    runSummarize: vi.fn(async (id: string) => {
      summarizeMocks.calls.push({ id, root: tenant.activeTenantDataRoot() });
    }),
  };
});

import { meetingPaths } from "@/lib/paths";
import { writeSettings } from "@/lib/settings";
import { initialStatus, writeStatus } from "@/lib/status";
import { runSummarizeTick } from "@/lib/summarizeWorker";
import {
  accountTenantDataRoot,
  baseDataRoot,
  runWithAccountTenantData,
} from "@/lib/tenantDataContext";

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "summarize-worker-tenants-"));
  process.chdir(workDir);
  summarizeMocks.calls.length = 0;
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

async function seedTranscribed(id: string): Promise<void> {
  const p = meetingPaths(id);
  await mkdir(p.dir, { recursive: true });
  await writeStatus(id, {
    ...initialStatus(id, {
      startedAt: "2026-07-05T09:00:00.000Z",
      endedAt: "2026-07-05T09:05:00.000Z",
      durationMs: 300_000,
      audioMime: "audio/webm;codecs=opus",
    }),
    status: "transcribed",
  });
  await writeFile(p.raw, "회의 원문\n");
}

describe("summarize worker tenant iteration", () => {
  it("visits every tenant root inside its own data context and skips the legacy root once tenants exist", async () => {
    await writeSettings({ provider: "openrouter" });
    await seedTranscribed("legacy-meeting");
    await runWithAccountTenantData("account-a", () => seedTranscribed("meeting-a"));
    await runWithAccountTenantData("account-b", () => seedTranscribed("meeting-b"));

    await runSummarizeTick();

    expect(summarizeMocks.calls).toEqual([
      { id: "meeting-a", root: accountTenantDataRoot("account-a") },
      { id: "meeting-b", root: accountTenantDataRoot("account-b") },
    ].sort((left, right) => left.root.localeCompare(right.root, "en")));
    expect(summarizeMocks.calls.some((call) => call.id === "legacy-meeting")).toBe(false);
  });

  it("falls back to the legacy data root while no tenant root exists", async () => {
    await writeSettings({ provider: "openrouter" });
    await seedTranscribed("legacy-meeting");

    await runSummarizeTick();

    expect(summarizeMocks.calls).toEqual([{ id: "legacy-meeting", root: baseDataRoot() }]);
  });

  it("does nothing while no summary model is configured", async () => {
    await runWithAccountTenantData("account-a", () => seedTranscribed("meeting-a"));

    await runSummarizeTick();

    expect(summarizeMocks.calls).toEqual([]);
  });
});
