import { summarySchema } from "@/domain/summarySchema";
import { readArtifactPair } from "@/lib/artifactPair";
import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { meetingFenceResponse } from "@/lib/meetingFence";
import { contentDispositionForMeeting, meetingDownloadBaseName } from "@/lib/meetingFilename";
import { assertSafeId } from "@/lib/meetingId";
import { publicErrorResponse } from "@/lib/publicApi";
import { automaticMeetingTitle, readStatus } from "@/lib/status";
import { formatMeetingMarkdown } from "@/lib/summaryMarkdown";

// GET /api/meetings/[id]/export?fmt=md|json — download the finished meeting for
// hand-off. `md` = summary + full transcript (the human doc); `json` = the raw
// summary contract. Download filenames use an RFC 5987 encoded, sanitized title
// plus the safe meeting id as an ASCII fallback.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  let id: string;
  try {
    id = assertSafeId((await params).id);
  } catch {
    return publicErrorResponse("invalid_request", 400, { field: "meetingId" });
  }
  const fenced = await meetingFenceResponse(id);
  if (fenced) return fenced;

  const pair = await readArtifactPair(id);
  const refenced = await meetingFenceResponse(id);
  if (refenced) return refenced;
  if (pair.state === "source_conflict") {
    return publicErrorResponse("content_source_conflict", 409, {
      meetingId: id,
      action: "export",
    });
  }
  if (pair.state === "ambiguous") {
    return publicErrorResponse("content_state_ambiguous", 409, {
      meetingId: id,
      action: "export",
    });
  }
  if (
    pair.state === "active"
    && (
      !pair.revision
      || !pair.contentRevision
      || pair.revision.transcriptSha256 !== pair.contentRevision.transcript.sha256
      || pair.revision.summarySha256 !== pair.contentRevision.summary.sha256
    )
  ) {
    return publicErrorResponse("content_operation_in_progress", 409, {
      meetingId: id,
      operation: "content_mutation",
    });
  }
  if (pair.summary === null) {
    return publicErrorResponse("meeting_not_found", 404, { meetingId: id });
  }
  const summary = summarySchema.parse(JSON.parse(pair.summary));
  const status = await readStatus(id);
  const effectiveTitle = status?.titleOverride
    ?? (status ? automaticMeetingTitle(status.startedAt, summary.title) : summary.title);

  // Dated download names are Global Meeting-only. The discriminator is the explicit
  // save-path marker `recordingKind === "transcript_only"`, which only the Global
  // Meeting session save (globalMeetingSave) writes — the ordinary audio finalize
  // path never sets it. Ordinary meetings keep their effective-title filename
  // byte-for-byte; we never infer "global" from title text nor broaden this default.
  const isGlobalMeeting = status?.recordingKind === "transcript_only";
  // Global download name = `YYYYMMDD_HHMMSS one-sentence-summary` from the immutable
  // meeting start time. A user title override is the best one-sentence descriptor;
  // otherwise the summarizer's one-liner, then its title; the meeting id is the
  // last-resort fallback so the name is never empty even if the summary lacks
  // descriptors. Both md and json use the same base for a Global Meeting.
  const oneSentenceSummary = status?.titleOverride?.trim()
    || summary.oneLine?.trim()
    || summary.title?.trim()
    || "";
  const downloadFilenameTitle = isGlobalMeeting
    ? meetingDownloadBaseName({
        startedAt: status?.startedAt ?? "",
        summary: oneSentenceSummary,
        fallback: id,
      })
    : effectiveTitle;

  const fmt = new URL(request.url).searchParams.get("fmt") ?? "md";

  if (fmt === "json") {
    // json stays the raw summary contract (summary.json verbatim) — the manual
    // titleOverride is a display-layer concern and is NOT overlaid here. Only the
    // human-facing md gets the effective title (below).
    return new Response(JSON.stringify(summary, null, 2) + "\n", {
      headers: {
        "content-type": "application/json",
        "content-disposition": contentDispositionForMeeting({
          title: downloadFilenameTitle,
          fallbackId: id,
          extension: "json",
        }),
        "cache-control": "no-store",
      },
    });
  }

  const transcript = pair.transcript ?? "";
  // md is the human hand-off doc, so its H1 reflects the effective title, matching
  // deriveStatus display semantics: a user override wins, else the summarizer's
  // title. (status.title is only a mirror of summary.title and is NOT reconciled
  // on this path — e.g. worker/manual-skill summaries leave it at the auto
  // placeholder — so it must not sit between the two.)
  const md = formatMeetingMarkdown(
    { ...summary, title: effectiveTitle },
    transcript,
    status?.review.participants ?? [],
    { summaryOutdated: pair.summaryOutdated === true },
  );

  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": contentDispositionForMeeting({
        title: downloadFilenameTitle,
        fallbackId: id,
        extension: "md",
      }),
      "cache-control": "no-store",
    },
  });
}
