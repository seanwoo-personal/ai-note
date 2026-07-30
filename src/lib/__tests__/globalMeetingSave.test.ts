// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetArtifactLeaseStateForTests } from "@/lib/artifactLease";
import { saveGlobalMeetingSession } from "@/lib/globalMeetingSave";
import { readResolvedLibraryState } from "@/lib/libraryService";
import { readMeetingLocation } from "@/lib/finalizePlacement";
import { resetLibraryRepositoryStateForTests } from "@/lib/library";
import { resetMeetingLifecycleForTests, tryAcquireMeetingOperation } from "@/lib/meetingLifecycle";
import { resetMeetingTombstoneStateForTests } from "@/lib/meetingTombstone";
import { resetMeetingCleanupStateForTests } from "@/lib/meetingCleanup";
import { resetOrganizationPendingStateForTests } from "@/lib/organizationPending";
import { meetingPaths } from "@/lib/paths";
import { createStatus, initialStatus, readStatus } from "@/lib/status";
import { resetStatusUpdaterStateForTests } from "@/lib/statusUpdater";

const TRANSCRIPT = "Speaker 1: 회의를 시작하겠습니다.\nSpeaker 2: Let's begin.\n";
const MINUTES = "회의록\n- 결정: 다음 주 배포\n- 액션: Sean 준비";

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
  workDir = mkdtempSync(join(tmpdir(), "global-meeting-save-"));
  process.chdir(workDir);
  resetAll();
});

afterEach(() => {
  process.chdir(originalCwd);
  resetAll();
  rmSync(workDir, { recursive: true, force: true });
});

describe("saveGlobalMeetingSession", () => {
  it("publishes a body-only canonical pair with no audio and places it in the requested workspace", async () => {
    const library = await readResolvedLibraryState();
    const workspaceId = library.document!.defaultWorkspaceId;
    const id = "gmeeting0000000000000000000000ab";

    const result = await saveGlobalMeetingSession({
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 90_000,
      transcript: TRANSCRIPT,
      minutesBody: MINUTES,
      title: "글로벌 미팅 세션",
      requestedLocation: { workspaceId, folderId: null },
    }, { now: () => "2026-07-30T01:02:00.000Z" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meeting.id).toBe(id);

    const paths = meetingPaths(id);
    const transcript = await readFile(paths.transcript, "utf8");
    expect(transcript).toBe(TRANSCRIPT);
    const summary = JSON.parse(await readFile(paths.summary, "utf8"));
    expect(summary.body).toBe(MINUTES);
    expect(summary.oneLine).toBe("");
    expect(summary.actionItems).toEqual([]);

    // No immutable whisper-owned originals are ever created for a streamed session.
    await expect(readFile(paths.audio, "utf8")).rejects.toBeTruthy();
    await expect(readFile(paths.raw, "utf8")).rejects.toBeTruthy();
    await expect(readFile(paths.segments, "utf8")).rejects.toBeTruthy();

    const status = await readStatus(id);
    expect(status?.status).toBe("summarized");
    expect(status?.recordingKind).toBe("transcript_only");
    expect(status?.audioMime).toBe("");

    const location = await readMeetingLocation(id);
    expect(location.location?.workspaceId).toBe(workspaceId);
    expect(location.location?.folderId).toBeNull();
  });

  it("rejects a duplicate end-save for the same session id without touching content", async () => {
    const id = "gmeeting1111111111111111111111ab";
    const first = await saveGlobalMeetingSession({
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 1_000,
      transcript: TRANSCRIPT,
      minutesBody: MINUTES,
    });
    expect(first.ok).toBe(true);

    const second = await saveGlobalMeetingSession({
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 1_000,
      transcript: "다른 내용",
      minutesBody: "다른 회의록",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already_saved");
    // The first save's content is preserved.
    expect(await readFile(meetingPaths(id).transcript, "utf8")).toBe(TRANSCRIPT);
  });

  it("repairs and verifies requested placement on an idempotent retry without replacing content", async () => {
    const library = await readResolvedLibraryState();
    const workspaceId = library.document!.defaultWorkspaceId;
    const id = "gmeeting3333333333333333333333ab";
    const input = {
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 1_000,
      transcript: TRANSCRIPT,
      minutesBody: MINUTES,
    };
    expect((await saveGlobalMeetingSession(input)).ok).toBe(true);

    const retried = await saveGlobalMeetingSession({
      ...input,
      transcript: "덮어쓰면 안 되는 내용",
      minutesBody: "덮어쓰면 안 되는 회의록",
      requestedLocation: { workspaceId, folderId: null },
    });

    expect(retried.ok).toBe(true);
    expect(await readFile(meetingPaths(id).transcript, "utf8")).toBe(TRANSCRIPT);
    const location = await readMeetingLocation(id);
    expect(location.location).toMatchObject({ workspaceId, folderId: null });
  });

  it("resumes an interrupted initial attempt without waiting on its own finalize lease", async () => {
    const id = "gmeeting4444444444444444444444ab";
    const finalize = await tryAcquireMeetingOperation(id, "finalize");
    expect(finalize).not.toBeNull();
    if (!finalize) return;
    await createStatus(id, {
      ...initialStatus(id, {
        startedAt: "2026-07-30T01:00:00.000Z",
        endedAt: "2026-07-30T01:01:00.000Z",
        durationMs: 60_000,
        recordingKind: "transcript_only",
        audioMime: "",
      }),
      summarizeAttempt: {
        attemptId: "44444444-4444-4444-8444-444444444444",
        kind: "initial",
        startedAt: "2026-07-30T01:01:00.000Z",
      },
    }, finalize.ownerToken);
    finalize.release();

    const result = await Promise.race([
      saveGlobalMeetingSession({
        id,
        startedAt: "2026-07-30T01:00:00.000Z",
        durationMs: 60_000,
        transcript: TRANSCRIPT,
        minutesBody: MINUTES,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("save_retry_deadlocked")), 1_000)),
    ]);

    expect(result.ok).toBe(true);
    expect(await readFile(meetingPaths(id).transcript, "utf8")).toBe(TRANSCRIPT);
  });

  it("recovers a crash after transcript publication before staging a retry", async () => {
    const id = "gmeeting5555555555555555555555ab";
    const crash = Object.assign(new Error("simulated process crash"), { simulateCrash: true });
    await expect(saveGlobalMeetingSession({
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 60_000,
      transcript: TRANSCRIPT,
      minutesBody: MINUTES,
    }, {
      publisherOptions: {
        barrier: (point) => {
          if (point === "after_transcript_publish") throw crash;
        },
      },
    })).rejects.toBe(crash);

    const recovered = await saveGlobalMeetingSession({
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 60_000,
      transcript: "재시도가 덮어쓰면 안 되는 대화록",
      minutesBody: "재시도가 덮어쓰면 안 되는 회의록",
    });

    expect(recovered.ok).toBe(true);
    expect(await readFile(meetingPaths(id).transcript, "utf8")).toBe(TRANSCRIPT);
    expect(JSON.parse(await readFile(meetingPaths(id).summary, "utf8")).body).toBe(MINUTES);
    expect((await readStatus(id))?.summarizeAttempt).toBeUndefined();
  });

  it("preserves a newer user placement on a late idempotent retry", async () => {
    const state = await readResolvedLibraryState();
    const originalWorkspaceId = state.document!.defaultWorkspaceId;
    const newerWorkspaceId = "66666666-6666-4666-8666-666666666666";
    await state.repository.transactLatest((document) => ({
      ...document,
      workspaces: [
        ...document.workspaces,
        {
          id: newerWorkspaceId,
          name: "Moved later",
          order: document.workspaces.length,
          createdAt: "2026-07-30T01:00:00.000Z",
          updatedAt: "2026-07-30T01:00:00.000Z",
        },
      ],
    }));
    const id = "gmeeting6666666666666666666666ab";
    const input = {
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 1_000,
      transcript: TRANSCRIPT,
      minutesBody: MINUTES,
      requestedLocation: { workspaceId: originalWorkspaceId, folderId: null },
    };
    expect((await saveGlobalMeetingSession(input)).ok).toBe(true);

    const moved = await readResolvedLibraryState();
    await moved.repository.transactLatest((document) => ({
      ...document,
      placements: [
        ...document.placements.filter((placement) => placement.meetingId !== id),
        { meetingId: id, workspaceId: newerWorkspaceId, folderId: null },
      ],
    }));

    expect((await saveGlobalMeetingSession(input)).ok).toBe(true);
    expect((await readMeetingLocation(id)).location).toMatchObject({
      workspaceId: newerWorkspaceId,
      folderId: null,
    });
  });

  it("applies a non-default requested placement after a crash that cleared publication status", async () => {
    const state = await readResolvedLibraryState();
    const requestedWorkspaceId = "77777777-7777-4777-8777-777777777777";
    await state.repository.transactLatest((document) => ({
      ...document,
      workspaces: [
        ...document.workspaces,
        {
          id: requestedWorkspaceId,
          name: "Requested destination",
          order: document.workspaces.length,
          createdAt: "2026-07-30T01:00:00.000Z",
          updatedAt: "2026-07-30T01:00:00.000Z",
        },
      ],
    }));
    const id = "gmeeting7777777777777777777777ab";
    const input = {
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 1_000,
      transcript: TRANSCRIPT,
      minutesBody: MINUTES,
      requestedLocation: { workspaceId: requestedWorkspaceId, folderId: null },
    };
    const crash = Object.assign(new Error("simulated post-publication crash"), { simulateCrash: true });
    await expect(saveGlobalMeetingSession(input, {
      publisherOptions: {
        barrier: (point) => {
          if (point === "after_status_clear") throw crash;
        },
      },
    })).rejects.toBe(crash);

    expect((await readStatus(id))?.placementResolution?.state).toBe("pending");
    expect((await saveGlobalMeetingSession(input)).ok).toBe(true);
    expect((await readMeetingLocation(id)).location).toMatchObject({
      workspaceId: requestedWorkspaceId,
      folderId: null,
    });
    expect((await readStatus(id))?.placementResolution?.state).toBe("resolved");
  });

  it("rejects an empty transcript before creating any meeting directory", async () => {
    const id = "gmeeting2222222222222222222222ab";
    const result = await saveGlobalMeetingSession({
      id,
      startedAt: "2026-07-30T01:00:00.000Z",
      durationMs: 1_000,
      transcript: "   \n  ",
      minutesBody: MINUTES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_transcript");
    expect(await readStatus(id)).toBeNull();
  });
});
