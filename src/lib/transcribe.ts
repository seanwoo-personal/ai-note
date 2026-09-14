import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { TranscriptionDispatch } from "@/domain/meeting";
import { atomicWriteFile } from "@/lib/atomicWrite";
import {
  acquireMeetingOperation,
  assertMeetingOperationOwner,
  tryAcquireMeetingOperation,
  type MeetingOperationLease,
} from "@/lib/meetingLifecycle";
import { meetingPaths } from "@/lib/paths";
import { readStatus, retryStatusDurability, updateStatus } from "@/lib/status";
import { inspectTranscriptionPublication } from "@/lib/transcriptionArtifacts";
import {
  cleanupSonioxResources,
  createSonioxTranscription,
  fetchSonioxTranscript,
  getSonioxTranscriptionStatus,
  sonioxTranscriptToArtifacts,
} from "@/services/sonioxAsync";

export type EnqueueResult =
  | {
      ok: true;
      jobId: string;
      dispatchId: string;
      durability: "durable" | "best_effort";
      state: "sent" | "completed";
    }
  | { ok: false; reason: "not_found" | "already_transcribed" | "in_progress" };

interface TranscriptionMonitorState {
  jobs: Map<string, Promise<void>>;
}

declare global {
  var __aiNoteTranscriptionMonitors: TranscriptionMonitorState | undefined;
}

function monitors(): TranscriptionMonitorState {
  globalThis.__aiNoteTranscriptionMonitors ??= { jobs: new Map() };
  return globalThis.__aiNoteTranscriptionMonitors;
}

export function resetTranscriptionMonitorsForTests(): void {
  globalThis.__aiNoteTranscriptionMonitors = { jobs: new Map() };
}

function acceptedDurability(
  durability: "none" | "durable" | "best_effort" | "pending",
): "durable" | "best_effort" {
  if (durability === "durable" || durability === "best_effort") return durability;
  if (durability === "pending") throw new Error("status_durability_pending");
  throw new Error("status_not_committed");
}

function mergeDurability(
  a: "durable" | "best_effort",
  b: "durable" | "best_effort",
): "durable" | "best_effort" {
  return a === "best_effort" || b === "best_effort" ? "best_effort" : "durable";
}

function completeDispatch(dispatch: TranscriptionDispatch): TranscriptionDispatch {
  return {
    dispatchId: dispatch.dispatchId,
    createdAt: dispatch.createdAt,
    state: "completed",
    service: "soniox",
  };
}

async function markCompleted(
  id: string,
  ownerToken: string | undefined,
  dispatch: TranscriptionDispatch,
): Promise<void> {
  await updateStatus(id, ownerToken, (latest) => {
    if (latest.transcriptionDispatch?.dispatchId !== dispatch.dispatchId) return latest;
    return {
      ...latest,
      status: "transcribed",
      error: null,
      transcriptionDispatch: completeDispatch(latest.transcriptionDispatch),
      // Kept in status.json for backward-compatible public progress payloads.
      whisper: { jobId: dispatch.dispatchId, progress: 1 },
    };
  });
}

async function monitorSonioxJob(id: string, dispatchId: string): Promise<void> {
  let lease: MeetingOperationLease | null = null;
  let remoteFileId: string | undefined;
  let remoteTranscriptionId: string | undefined;
  try {
    const status = await readStatus(id);
    const dispatch = status?.transcriptionDispatch;
    if (!dispatch || dispatch.dispatchId !== dispatchId || dispatch.state === "completed") return;
    remoteFileId = dispatch.remoteFileId;
    remoteTranscriptionId = dispatch.remoteTranscriptionId;
    if (!remoteFileId || !remoteTranscriptionId) throw new Error("soniox_job_missing");

    const deadline = Date.now() + 6 * 60 * 60 * 1_000;
    for (;;) {
      const state = await getSonioxTranscriptionStatus(remoteTranscriptionId);
      if (state === "completed") break;
      if (state === "error") throw new Error("soniox_transcription_failed");
      if (Date.now() >= deadline) throw new Error("soniox_transcription_timeout");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const transcript = await fetchSonioxTranscript(remoteTranscriptionId);
    const artifacts = sonioxTranscriptToArtifacts(transcript);
    // Do not hold a meeting mutation lease during remote polling. Acquire it
    // only for the short local publication so finalize probes remain available.
    lease = await acquireMeetingOperation(id, "transcribe_publish");
    const latest = await readStatus(id);
    if (
      latest?.transcriptionDispatch?.dispatchId !== dispatchId
      || latest.transcriptionDispatch.remoteTranscriptionId !== remoteTranscriptionId
    ) return;
    const paths = meetingPaths(id);
    // segments first; raw.md is the immutable completion marker.
    await atomicWriteFile(paths.segments, `${JSON.stringify(artifacts.segments, null, 2)}\n`);
    await atomicWriteFile(paths.raw, artifacts.raw);
    await markCompleted(id, lease.ownerToken, latest.transcriptionDispatch);
  } catch {
    lease ??= await acquireMeetingOperation(id, "transcribe_publish").catch(() => null);
    await updateStatus(id, lease?.ownerToken, (latest) => {
      const dispatch = latest.transcriptionDispatch;
      if (!dispatch || dispatch.dispatchId !== dispatchId) return latest;
      return {
        ...latest,
        status: "transcribing",
        error: {
          code: "transcription_failed",
          message: "전사를 완료하지 못했습니다. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요",
          action: "retry_transcription",
        },
        transcriptionDispatch: {
          dispatchId: dispatch.dispatchId,
          createdAt: dispatch.createdAt,
          state: "failed",
          service: "soniox",
        },
      };
    }).catch(() => {});
  } finally {
    await cleanupSonioxResources({
      fileId: remoteFileId,
      transcriptionId: remoteTranscriptionId,
    });
    lease?.release();
  }
}

function scheduleMonitor(id: string, dispatchId: string): void {
  const key = `${id}:${dispatchId}`;
  if (monitors().jobs.has(key)) return;
  const job = monitorSonioxJob(id, dispatchId)
    .catch(() => {})
    .finally(() => monitors().jobs.delete(key));
  monitors().jobs.set(key, job);
}

/** Resume a persisted cloud job after a server restart or status poll. */
export async function resumeTranscription(id: string): Promise<boolean> {
  const status = await readStatus(id);
  const dispatch = status?.transcriptionDispatch;
  if (
    status?.status !== "transcribing"
    || !dispatch
    || dispatch.service !== "soniox"
    || !dispatch.remoteFileId
    || !dispatch.remoteTranscriptionId
  ) return false;
  scheduleMonitor(id, dispatch.dispatchId);
  return true;
}

export async function enqueueTranscription(
  id: string,
  options: { ownerToken?: string } = {},
): Promise<EnqueueResult> {
  let lease: MeetingOperationLease | null = null;
  if (options.ownerToken) assertMeetingOperationOwner(id, options.ownerToken);
  else {
    lease = await tryAcquireMeetingOperation(id, "transcribe_dispatch");
    if (!lease) return { ok: false, reason: "in_progress" };
  }
  const ownerToken = options.ownerToken ?? lease!.ownerToken;
  let monitorDispatchId: string | null = null;
  try {
    let status = await readStatus(id);
    if (!status) return { ok: false, reason: "not_found" };
    let durability: "durable" | "best_effort" = "durable";
    if (status.transcriptionDispatch) {
      durability = acceptedDurability(await retryStatusDurability(id));
    }

    const publication = inspectTranscriptionPublication(
      id,
      status.transcriptionDispatch?.dispatchId,
    );
    if (publication.state === "complete") {
      if (status.transcriptionDispatch) {
        await markCompleted(id, ownerToken, status.transcriptionDispatch);
      }
      return { ok: false, reason: "already_transcribed" };
    }
    if (publication.state === "ambiguous") {
      throw new Error("transcription_publication_ambiguous");
    }
    if (status.status !== "recorded" && status.status !== "transcribing") {
      return { ok: false, reason: "already_transcribed" };
    }

    const existing = status.transcriptionDispatch;
    if (
      existing?.service === "soniox"
      && existing.remoteFileId
      && existing.remoteTranscriptionId
      && existing.state !== "failed"
    ) {
      monitorDispatchId = existing.dispatchId;
      return {
        ok: true,
        jobId: existing.dispatchId,
        dispatchId: existing.dispatchId,
        durability,
        state: "sent",
      };
    }

    const dispatch: TranscriptionDispatch = existing?.state === "failed"
      ? {
          dispatchId: existing.dispatchId,
          createdAt: existing.createdAt,
          state: "proposed",
          service: "soniox",
        }
      : {
          dispatchId: randomUUID(),
          createdAt: new Date().toISOString(),
          state: "proposed",
          service: "soniox",
        };
    const proposed = await updateStatus(id, ownerToken, (latest) => ({
      ...latest,
      status: "transcribing",
      error: null,
      transcriptionDispatch: dispatch,
      whisper: { jobId: dispatch.dispatchId, progress: 0 },
    }));
    durability = mergeDurability(durability, acceptedDurability(proposed.commit.durability));

    const paths = meetingPaths(id);
    const audio = await readFile(paths.audio);
    const job = await createSonioxTranscription({
      audio,
      filename: "audio.webm",
      meetingId: id,
    });
    const sent = await updateStatus(id, ownerToken, (latest) =>
      latest.transcriptionDispatch?.dispatchId === dispatch.dispatchId
        ? {
            ...latest,
            status: "transcribing",
            error: null,
            transcriptionDispatch: {
              ...dispatch,
              state: "sent",
              remoteFileId: job.fileId,
              remoteTranscriptionId: job.transcriptionId,
            },
            whisper: { jobId: dispatch.dispatchId, progress: 0.1 },
          }
        : latest);
    durability = mergeDurability(durability, acceptedDurability(sent.commit.durability));
    monitorDispatchId = dispatch.dispatchId;
    status = await readStatus(id);
    if (!status?.transcriptionDispatch) throw new Error("transcription_dispatch_missing");
    return {
      ok: true,
      jobId: dispatch.dispatchId,
      dispatchId: dispatch.dispatchId,
      durability,
      state: "sent",
    };
  } finally {
    lease?.release();
    if (monitorDispatchId) scheduleMonitor(id, monitorDispatchId);
  }
}
