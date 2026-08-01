const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/gu;
const UNSAFE_FILENAME_CHARACTERS = /[\\/?%*:|"<>]+/gu;

function sanitizeFilenamePart(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(UNSAFE_FILENAME_CHARACTERS, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "")
    .slice(0, 160);
}

const COMPACT_TIMESTAMP_FALLBACK = "00000000_000000";

// `YYYYMMDD_HHMMSS` in the product's LOCAL wall-clock — the same semantics as
// automaticMeetingTitle in src/lib/status.ts (getFullYear/getHours…), so the dated
// download name matches the meeting's displayed date/time exactly. The start time
// is immutable (captured once), so repeated saves of the same meeting stay
// byte-stable within a given locale.
function compactStartTimestamp(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return COMPACT_TIMESTAMP_FALLBACK;
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

// Default download/export base name: `YYYYMMDD_HHMMSS one-sentence-summary`. The
// timestamp comes from the immutable meeting START time (captured once), and the
// summary is sanitized; when it is absent/blank a deterministic fallback is used
// so the name is never empty and generation never blocks on an AI summary. The
// extension is appended later by `contentDispositionForMeeting`, which sanitizes
// only the base and never the timestamp prefix.
export function meetingDownloadBaseName(input: {
  startedAt: string;
  summary?: string | null;
  fallback: string;
}): string {
  const timestamp = compactStartTimestamp(input.startedAt);
  const summaryPart = sanitizeFilenamePart(input.summary ?? "").slice(0, 120).trim();
  const fallback = sanitizeFilenamePart(input.fallback) || "meeting";
  return `${timestamp} ${summaryPart || fallback}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

export function contentDispositionForMeeting(input: {
  title: string;
  fallbackId: string;
  extension: string;
}): string {
  const extension = input.extension.replace(/[^A-Za-z0-9]/gu, "").toLowerCase() || "txt";
  const fallback = input.fallbackId.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80) || "meeting";
  const title = sanitizeFilenamePart(input.title) || fallback;
  const unicodeFilename = `${title}.${extension}`;
  return `attachment; filename="${fallback}.${extension}"; filename*=UTF-8''${encodeRfc5987(unicodeFilename)}`;
}
