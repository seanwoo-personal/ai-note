// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as sessionPOST } from "@/app/api/meetings/[id]/session/route";
import { resetArtifactLeaseStateForTests } from "@/lib/artifactLease";
import { resetLibraryRepositoryStateForTests } from "@/lib/library";
import { readResolvedLibraryState } from "@/lib/libraryService";
import { readMeetingLocation } from "@/lib/finalizePlacement";
import { resetMeetingCleanupStateForTests } from "@/lib/meetingCleanup";
import { resetMeetingLifecycleForTests } from "@/lib/meetingLifecycle";
import { resetMeetingTombstoneStateForTests } from "@/lib/meetingTombstone";
import { resetOrganizationPendingStateForTests } from "@/lib/organizationPending";
import { meetingPaths } from "@/lib/paths";
import { resetStatusUpdaterStateForTests } from "@/lib/statusUpdater";

const ORIGIN = "http://127.0.0.1:3000";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function sessionRequest(id: string, body: unknown): Request {
  return new Request(`${ORIGIN}/api/meetings/${id}/session`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let originalCwd: string;
let workDir: string;

function resetAll() {
  resetArtifactLeaseStateForTests();
  resetMeetingLifecycleForTests();
  resetStatusUpdaterStateForTests();
  resetMeetingTombstoneStateForTests();
  resetMeetingCleanupStateForTests();
  resetLibraryRepositoryStateForTests();
  resetOrganizationPendingStateForTests();
}

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "session-route-"));
  process.chdir(workDir);
  resetAll();
});

afterEach(() => {
  process.chdir(originalCwd);
  resetAll();
  rmSync(workDir, { recursive: true, force: true });
});

const ID = "session00000000000000000000000ab";
const VALID = {
  startedAt: "2026-07-30T01:00:00.000Z",
  durationMs: 60_000,
  transcript: "Speaker 1: 안녕하세요.\nSpeaker 2: Hello.\n",
  minutesBody: "회의록\n- 결정: 배포",
  title: "글로벌 미팅",
};

describe("POST /api/meetings/[id]/session", () => {
  it("saves a streamed session into the selected workspace and returns the public meeting", async () => {
    const library = await readResolvedLibraryState();
    const workspaceId = library.document!.defaultWorkspaceId;

    const response = await sessionPOST(
      sessionRequest(ID, { ...VALID, workspaceId, folderId: null }),
      ctx(ID),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.id).toBe(ID);
    expect(payload.status).toBe("summarized");

    const paths = meetingPaths(ID);
    expect(await readFile(paths.transcript, "utf8")).toBe(VALID.transcript);
    const summary = JSON.parse(await readFile(paths.summary, "utf8"));
    expect(summary.body).toBe(VALID.minutesBody);

    const location = await readMeetingLocation(ID);
    expect(location.location?.workspaceId).toBe(workspaceId);
  });

  it("rejects a duplicate end-save with 409 and preserves the first content", async () => {
    await sessionPOST(sessionRequest(ID, VALID), ctx(ID));
    const dup = await sessionPOST(
      sessionRequest(ID, { ...VALID, transcript: "다른 내용", minutesBody: "다른 회의록" }),
      ctx(ID),
    );
    expect(dup.status).toBe(409);
    expect(await readFile(meetingPaths(ID).transcript, "utf8")).toBe(VALID.transcript);
  });

  it("rejects an empty transcript with 400", async () => {
    const response = await sessionPOST(
      sessionRequest(ID, { ...VALID, transcript: "   " }),
      ctx(ID),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a cross-site request before touching data", async () => {
    const request = new Request(`${ORIGIN}/api/meetings/${ID}/session`, {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify(VALID),
    });
    const response = await sessionPOST(request, ctx(ID));
    expect(response.status).toBe(403);
  });
});
