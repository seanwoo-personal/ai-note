import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { SummarizeAttempt } from "@/domain/meeting";
import { summarySchema } from "@/domain/summarySchema";
import type { FinalizeLocation } from "@/lib/finalizeRecord";
import { resolveRequestedPlacementTarget } from "@/lib/finalizePlacement";
import { readResolvedLibraryState } from "@/lib/libraryService";
import {
  tryAcquireMeetingOperation,
} from "@/lib/meetingLifecycle";
import { invalidateOrganizationPending } from "@/lib/organizationPending";
import { meetingPaths } from "@/lib/paths";
import { toPublicMeeting, type PublicMeeting } from "@/lib/publicApi";
import { createStatus, initialStatus, readStatus, updateStatus } from "@/lib/status";
import { StatusUpdaterError } from "@/lib/statusUpdater";
import {
  publishPreparedMeetingPair,
  reconcilePreparedMeetingPair,
} from "@/lib/summarize";
import {
  type SummarizePublisherOptions,
} from "@/lib/summarizePublisher";

// Persists a client-produced Global Meeting session (streamed to Soniox with no
// retained audio blob) as a canonical library meeting. It never touches the
// immutable whisper-owned originals (audio.webm/raw.md/segments.json) and never
// enqueues transcription: the transcript + minutes are published through the
// sanctioned pair publisher as a fresh `initial` attempt, and the meeting is
// placed into the caller's selected workspace/folder via the library repository.

export interface SaveGlobalMeetingSessionInput {
  id: string;
  startedAt: string;
  durationMs: number;
  /** Full session transcript text → transcript.md */
  transcript: string;
  /** Session minutes text → summary.json manual body */
  minutesBody: string;
  title?: string;
  participants?: string[];
  requestedLocation?: FinalizeLocation;
}

export interface GlobalMeetingSaveOptions {
  now?: () => string;
  publisherOptions?: SummarizePublisherOptions;
}

export type SaveGlobalMeetingSessionResult =
  | {
      ok: true;
      meeting: PublicMeeting;
      durability: "durable" | "best_effort" | "pending";
    }
  | {
      ok: false;
      reason:
        | "invalid_transcript"
        | "invalid_minutes"
        | "already_saved"
        | "operation_in_progress"
        | "save_unavailable";
    };

function normalizeMinutes(value: string): string {
  return value.replace(/\r\n/gu, "\n");
}

function placementReceiptHash(location: FinalizeLocation): string {
  return createHash("sha256")
    .update(JSON.stringify({
      workspaceId: location.workspaceId,
      folderId: location.folderId ?? null,
    }))
    .digest("hex");
}

function bodyOnlySummary(input: {
  title: string;
  topicSlug: string;
  participants: string[];
  body: string;
}): string {
  const data = summarySchema.parse({
    title: input.title,
    topicSlug: input.topicSlug,
    participants: input.participants,
    body: input.body,
    oneLine: "",
    purpose: "",
    highlights: [],
    discussion: [],
    decisions: [],
    actionItems: [],
    risks: [],
    followups: [],
  });
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function isAlreadyPublished(id: string, hasPendingAttempt: boolean): Promise<boolean> {
  // This probe runs while the caller owns the exclusive finalize lease. Calling
  // readArtifactPair() here would try to acquire summarize_reconcile for an
  // interrupted attempt and deadlock behind our own finalize lease. A completed
  // publication clears summarizeAttempt only after both canonical files land.
  if (hasPendingAttempt) return false;
  try {
    const paths = meetingPaths(id);
    const [transcript, summary] = await Promise.all([
      readFile(paths.transcript),
      readFile(paths.summary),
    ]);
    return transcript.byteLength > 0 && summary.byteLength > 0;
  } catch {
    return false;
  }
}

async function placeMeeting(
  id: string,
  requested: FinalizeLocation,
  options: { preserveExisting?: boolean } = {},
): Promise<void> {
  const state = await readResolvedLibraryState();
  if (state.mode !== "ready" || !state.document) throw new Error("library_unavailable");
  const transaction = await state.repository.transactLatest((document) => {
    const existing = document.placements.find((placement) => placement.meetingId === id);
    if (options.preserveExisting && existing) return document;
    const resolution = resolveRequestedPlacementTarget(document, requested);
    return {
      ...document,
      placements: [
        ...document.placements.filter((placement) => placement.meetingId !== id),
        { meetingId: id, ...resolution.target },
      ],
    };
  });
  const placement = transaction.document.placements.find((candidate) => candidate.meetingId === id);
  if (options.preserveExisting && placement) {
    invalidateOrganizationPending();
    return;
  }
  const committedTarget = resolveRequestedPlacementTarget(transaction.document, requested).target;
  if (
    !placement
    || placement.workspaceId !== committedTarget.workspaceId
    || placement.folderId !== committedTarget.folderId
  ) throw new Error("placement_not_committed");
  invalidateOrganizationPending();
}

async function commitRequestedPlacement(
  id: string,
  requested: FinalizeLocation,
  ownerToken: string,
): Promise<void> {
  const status = await readStatus(id);
  if (!status) throw new Error("status_unavailable");
  const resolution = status.placementResolution;
  if (
    resolution?.state === "pending"
    && resolution.receiptHash !== placementReceiptHash(requested)
  ) throw new Error("placement_intent_mismatch");

  // Pending resolution suppresses synthetic default materialization. Therefore
  // an existing placement is explicit (including a later user move) and wins;
  // otherwise the originally requested target is inserted.
  await placeMeeting(id, requested, { preserveExisting: true });
  if (resolution?.state === "pending") {
    await updateStatus(id, ownerToken, (latest) => latest.placementResolution?.state === "pending"
      ? {
          ...latest,
          placementResolution: {
            state: "resolved",
            receiptHash: latest.placementResolution.receiptHash,
          },
        }
      : latest);
  }
}

export async function saveGlobalMeetingSession(
  input: SaveGlobalMeetingSessionInput,
  options: GlobalMeetingSaveOptions = {},
): Promise<SaveGlobalMeetingSessionResult> {
  const transcript = input.transcript.trim().length > 0 ? input.transcript : null;
  if (!transcript) return { ok: false, reason: "invalid_transcript" };
  const minutesBody = normalizeMinutes(input.minutesBody);
  if (minutesBody.trim().length === 0) return { ok: false, reason: "invalid_minutes" };

  const lease = await tryAcquireMeetingOperation(input.id, "finalize");
  if (!lease) return { ok: false, reason: "operation_in_progress" };
  try {
    const now = options.now?.() ?? new Date().toISOString();
    let existing = await readStatus(input.id);

    // A previous process may have crashed after staging or after publishing only
    // the transcript. Reconcile that durable manifest before any new staging can
    // overwrite it. A manifest-less attempt is safely cleared as interrupted and
    // then seeded again below.
    if (existing?.summarizeAttempt) {
      if (existing.summarizeAttempt.kind !== "initial") {
        return { ok: false, reason: "operation_in_progress" };
      }
      let reconciled: Awaited<ReturnType<typeof reconcilePreparedMeetingPair>>;
      try {
        reconciled = await reconcilePreparedMeetingPair(input.id, lease.ownerToken);
      } catch {
        return { ok: false, reason: "save_unavailable" };
      }
      if (reconciled.state === "ambiguous") {
        return { ok: false, reason: "save_unavailable" };
      }
      existing = await readStatus(input.id);
      if (reconciled.state === "completed") {
        if (!existing) return { ok: false, reason: "save_unavailable" };
        if (input.requestedLocation) {
          try {
            await commitRequestedPlacement(input.id, input.requestedLocation, lease.ownerToken);
          } catch {
            return { ok: false, reason: "save_unavailable" };
          }
        }
        return { ok: true, meeting: toPublicMeeting(existing), durability: "pending" };
      }
    }

    // Resume support: a status that exists with a published canonical pair is a
    // completed save; re-ending the same session must never clobber content or a
    // newer user-selected placement.
    if (existing) {
      if (await isAlreadyPublished(input.id, Boolean(existing.summarizeAttempt))) {
        if (!input.requestedLocation) return { ok: false, reason: "already_saved" };
        try {
          await commitRequestedPlacement(input.id, input.requestedLocation, lease.ownerToken);
        } catch {
          return { ok: false, reason: "save_unavailable" };
        }
        return { ok: true, meeting: toPublicMeeting(existing), durability: "durable" };
      }
    }

    const title = input.title?.trim() || undefined;
    const summary = bodyOnlySummary({
      title: title ?? "",
      topicSlug: "",
      participants: input.participants ?? [],
      body: minutesBody,
    });

    let attempt: SummarizeAttempt;
    let statusDurability: "durable" | "best_effort" | "pending" = "durable";
    if (existing?.summarizeAttempt?.kind === "initial") {
      // Interrupted prior save: resume with the same attempt so the publisher's
      // idempotent staging can complete the canonical pair.
      attempt = existing.summarizeAttempt;
    } else {
      attempt = { attemptId: randomUUID(), kind: "initial", startedAt: now };
      const base = initialStatus(input.id, {
        startedAt: input.startedAt,
        endedAt: now,
        durationMs: input.durationMs,
        recordingKind: "transcript_only",
        audioMime: "",
      });
      const seeded = {
        ...base,
        summarizeAttempt: attempt,
        ...(input.requestedLocation ? {
          placementResolution: {
            state: "pending" as const,
            receiptHash: placementReceiptHash(input.requestedLocation),
          },
        } : {}),
        ...(title ? { titleOverride: title } : {}),
      };
      try {
        const written = existing
          ? await updateStatus(input.id, lease.ownerToken, (latest) => ({
              ...latest,
              summarizeAttempt: attempt,
              error: null,
              ...(input.requestedLocation ? {
                placementResolution: {
                  state: "pending" as const,
                  receiptHash: placementReceiptHash(input.requestedLocation),
                },
              } : {}),
              ...(title ? { titleOverride: title } : {}),
            }))
          : await createStatus(input.id, seeded, lease.ownerToken);
        statusDurability = written.commit.durability === "none" ? "pending" : written.commit.durability;
      } catch (error) {
        if (error instanceof StatusUpdaterError && error.code === "status_already_exists") {
          return { ok: false, reason: "already_saved" };
        }
        return { ok: false, reason: "save_unavailable" };
      }
    }

    let artifactDurability: "durable" | "best_effort" | "pending";
    try {
      const publication = await publishPreparedMeetingPair({
        id: input.id,
        ownerToken: lease.ownerToken,
        attempt,
        transcript,
        summary,
      }, options.publisherOptions);
      artifactDurability = publication.artifactDurability;
      statusDurability = publication.statusDurability;
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "simulateCrash" in error
        && error.simulateCrash === true
      ) throw error;
      // Best-effort resume: if the pair actually landed, treat as pending success.
      try {
        const reconciled = await reconcilePreparedMeetingPair(input.id, lease.ownerToken);
        if (reconciled.state !== "completed") return { ok: false, reason: "save_unavailable" };
        artifactDurability = "pending";
        statusDurability = "pending";
      } catch {
        return { ok: false, reason: "save_unavailable" };
      }
    }

    if (input.requestedLocation) {
      try {
        await commitRequestedPlacement(input.id, input.requestedLocation, lease.ownerToken);
      } catch {
        // The canonical pair is intentionally retained for an idempotent retry,
        // but success is not reported until the requested placement is verified.
        return { ok: false, reason: "save_unavailable" };
      }
    }

    const status = await readStatus(input.id);
    if (!status) return { ok: false, reason: "save_unavailable" };
    const durability: "durable" | "best_effort" | "pending" =
      artifactDurability === "pending" || statusDurability === "pending"
        ? "pending"
        : artifactDurability === "best_effort" || statusDurability === "best_effort"
          ? "best_effort"
          : "durable";
    return { ok: true, meeting: toPublicMeeting(status), durability };
  } finally {
    lease.release();
  }
}
