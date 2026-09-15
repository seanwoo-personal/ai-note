// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/accountSession", () => ({
  resolveRequestSession: sessionMocks.resolve,
}));

import { POST as finalizePOST } from "@/app/api/meetings/[id]/finalize/route";
import { resetArtifactLeaseStateForTests } from "@/lib/artifactLease";
import { resetLibraryRepositoryStateForTests } from "@/lib/library";
import { resetMeetingCleanupStateForTests } from "@/lib/meetingCleanup";
import { resetMeetingLifecycleForTests } from "@/lib/meetingLifecycle";
import { resetMeetingTombstoneStateForTests } from "@/lib/meetingTombstone";
import { resetStatusUpdaterStateForTests } from "@/lib/statusUpdater";
import { accountTenantDataRoot, baseDataRoot } from "@/lib/tenantDataContext";
import {
  awaitTranscriptionMonitorsForTests,
  resetTranscriptionMonitorsForTests,
} from "@/lib/transcribe";

const ORIGIN = "http://127.0.0.1:3000";
const SESSION_ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function finalizeRequest(id: string, headers: Record<string, string> = {}): Request {
  const path = `/api/meetings/${id}/finalize?durationMs=1&mime=audio%2Fwebm&startedAt=2026-07-10T00%3A00%3A00.000Z`;
  const request = new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: ORIGIN,
      "content-type": "audio/webm",
      ...headers,
    },
  });
  Object.defineProperty(request, "body", {
    get() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        },
      });
    },
  });
  return request;
}

function statusPath(root: string, id: string): string {
  return join(root, "meetings", id, "status.json");
}

function session(accountId: string) {
  return {
    account: { id: accountId, role: "customer", passwordChangeRequired: false },
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

let originalCwd: string;
let workDir: string;

function resetAll() {
  resetArtifactLeaseStateForTests();
  resetLibraryRepositoryStateForTests();
  resetMeetingCleanupStateForTests();
  resetMeetingLifecycleForTests();
  resetMeetingTombstoneStateForTests();
  resetStatusUpdaterStateForTests();
  resetTranscriptionMonitorsForTests();
}

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "finalize-tenant-"));
  process.chdir(workDir);
  process.env.FAKE_FFMPEG = "1";
  process.env.FAKE_SONIOX = "1";
  delete process.env.AI_NOTE_DEPLOYMENT_MODE;
  sessionMocks.resolve.mockReset();
  sessionMocks.resolve.mockResolvedValue(null);
  resetAll();
});

afterEach(async () => {
  await awaitTranscriptionMonitorsForTests();
  process.chdir(originalCwd);
  delete process.env.FAKE_FFMPEG;
  delete process.env.FAKE_SONIOX;
  delete process.env.AI_NOTE_DEPLOYMENT_MODE;
  resetAll();
  rmSync(workDir, { recursive: true, force: true });
});

describe("finalize tenant boundary", () => {
  it("rejects a forged account header without a session in cloud mode and touches no tenant root", async () => {
    process.env.AI_NOTE_DEPLOYMENT_MODE = "cloud";
    const id = "meeting-forged-no-session";

    const response = await finalizePOST(
      finalizeRequest(id, { "x-vision-account-id": OTHER_ACCOUNT }),
      ctx(id),
    );

    expect(response.status).toBe(401);
    expect(existsSync(join(baseDataRoot(), "tenants"))).toBe(false);
    expect(existsSync(statusPath(baseDataRoot(), id))).toBe(false);
  });

  it("writes only under the session account even when the request carries another account header", async () => {
    process.env.AI_NOTE_DEPLOYMENT_MODE = "cloud";
    sessionMocks.resolve.mockResolvedValue(session(SESSION_ACCOUNT));
    const id = "meeting-session-wins";

    const response = await finalizePOST(
      finalizeRequest(id, { "x-vision-account-id": OTHER_ACCOUNT }),
      ctx(id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id, artifact: "published" });
    expect(existsSync(statusPath(accountTenantDataRoot(SESSION_ACCOUNT), id))).toBe(true);
    expect(existsSync(statusPath(accountTenantDataRoot(OTHER_ACCOUNT), id))).toBe(false);
    expect(existsSync(statusPath(baseDataRoot(), id))).toBe(false);

    // Background transcription publication must keep the same tenant root.
    await awaitTranscriptionMonitorsForTests();
    expect(existsSync(join(accountTenantDataRoot(SESSION_ACCOUNT), "meetings", id, "raw.md"))).toBe(true);
    expect(existsSync(join(baseDataRoot(), "meetings", id, "raw.md"))).toBe(false);
  });

  it("uses the session tenant root outside cloud mode too, matching every other product route", async () => {
    sessionMocks.resolve.mockResolvedValue(session(SESSION_ACCOUNT));
    const id = "meeting-local-session";

    const response = await finalizePOST(finalizeRequest(id), ctx(id));

    expect(response.status).toBe(200);
    expect(existsSync(statusPath(accountTenantDataRoot(SESSION_ACCOUNT), id))).toBe(true);
    expect(existsSync(statusPath(baseDataRoot(), id))).toBe(false);
  });

  it("rejects a bare account header outside cloud mode because middleware never sets it for finalize", async () => {
    const id = "meeting-local-forged";

    const response = await finalizePOST(
      finalizeRequest(id, { "x-vision-account-id": OTHER_ACCOUNT }),
      ctx(id),
    );

    expect(response.status).toBe(401);
    expect(existsSync(join(baseDataRoot(), "tenants"))).toBe(false);
    expect(existsSync(statusPath(baseDataRoot(), id))).toBe(false);
  });

  it("keeps the legacy single-user data root only when no identity is presented outside cloud mode", async () => {
    const id = "meeting-legacy-compat";

    const response = await finalizePOST(finalizeRequest(id), ctx(id));

    expect(response.status).toBe(200);
    expect(existsSync(statusPath(baseDataRoot(), id))).toBe(true);
    expect(existsSync(join(baseDataRoot(), "tenants"))).toBe(false);
  });
});
