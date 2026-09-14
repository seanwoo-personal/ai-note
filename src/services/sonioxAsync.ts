import { randomUUID } from "node:crypto";

const SONIOX_BASE_URL = "https://api.soniox.com/v1";
const REQUEST_TIMEOUT_MS = 60_000;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u;

export interface SonioxJobIds {
  fileId: string;
  transcriptionId: string;
}

export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: string | number;
  language?: string;
  translation_status?: string;
}

export interface SonioxTranscript {
  tokens: SonioxToken[];
}

export interface SonioxSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

function apiKey(): string {
  const key = process.env.SONIOX_API_KEY?.trim();
  if (!key) throw new Error("soniox_key_missing");
  return key;
}

function safeId(value: unknown, code: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(code);
  return value;
}

async function sonioxFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${SONIOX_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      ...init.headers,
    },
    cache: "no-store",
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`soniox_status_${response.status}`);
  return response;
}

async function safeObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("soniox_invalid_response");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === "soniox_invalid_response") throw error;
    throw new Error("soniox_invalid_response");
  }
}

export async function createSonioxTranscription(args: {
  audio: Uint8Array;
  filename: string;
  meetingId: string;
}): Promise<SonioxJobIds> {
  if (process.env.FAKE_SONIOX === "1") {
    return {
      fileId: `fake-file-${randomUUID()}`,
      transcriptionId: `fake-transcription-${randomUUID()}`,
    };
  }
  const form = new FormData();
  const bytes = new Uint8Array(args.audio.byteLength);
  bytes.set(args.audio);
  form.append("file", new Blob([bytes.buffer]), args.filename);
  const upload = await safeObject(await sonioxFetch("/files", {
    method: "POST",
    body: form,
  }));
  const fileId = safeId(upload.id, "soniox_invalid_file_id");

  try {
    const created = await safeObject(await sonioxFetch("/transcriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "stt-async-v5",
        file_id: fileId,
        language_hints: ["ko", "ja", "en", "zh"],
        enable_language_identification: true,
        enable_speaker_diarization: true,
        client_reference_id: args.meetingId,
      }),
    }));
    return {
      fileId,
      transcriptionId: safeId(created.id, "soniox_invalid_transcription_id"),
    };
  } catch (error) {
    // Uploads are retained by Soniox until explicitly deleted.
    await deleteResource(`/files/${encodeURIComponent(fileId)}`);
    throw error;
  }
}

export type SonioxTranscriptionStatus = "processing" | "completed" | "error";

export async function getSonioxTranscriptionStatus(
  transcriptionId: string,
): Promise<SonioxTranscriptionStatus> {
  if (process.env.FAKE_SONIOX === "1") return "completed";
  const id = safeId(transcriptionId, "soniox_invalid_transcription_id");
  const value = await safeObject(await sonioxFetch(`/transcriptions/${encodeURIComponent(id)}`));
  if (value.status === "completed") return "completed";
  if (value.status === "error") return "error";
  if (typeof value.status === "string") return "processing";
  throw new Error("soniox_invalid_response");
}

export async function fetchSonioxTranscript(
  transcriptionId: string,
): Promise<SonioxTranscript> {
  if (process.env.FAKE_SONIOX === "1") {
    return { tokens: [{ text: "테스트 회의 전사입니다.", start_ms: 0, end_ms: 1_000 }] };
  }
  const id = safeId(transcriptionId, "soniox_invalid_transcription_id");
  const value = await safeObject(await sonioxFetch(
    `/transcriptions/${encodeURIComponent(id)}/transcript`,
  ));
  if (!Array.isArray(value.tokens) || value.tokens.length > 2_000_000) {
    throw new Error("soniox_invalid_transcript");
  }
  const tokens: SonioxToken[] = [];
  for (const token of value.tokens) {
    if (!token || typeof token !== "object" || Array.isArray(token)) {
      throw new Error("soniox_invalid_transcript");
    }
    const candidate = token as Record<string, unknown>;
    if (typeof candidate.text !== "string") throw new Error("soniox_invalid_transcript");
    tokens.push({
      text: candidate.text,
      ...(typeof candidate.start_ms === "number" && Number.isFinite(candidate.start_ms)
        ? { start_ms: candidate.start_ms }
        : {}),
      ...(typeof candidate.end_ms === "number" && Number.isFinite(candidate.end_ms)
        ? { end_ms: candidate.end_ms }
        : {}),
      ...(typeof candidate.speaker === "string" || typeof candidate.speaker === "number"
        ? { speaker: candidate.speaker }
        : {}),
      ...(typeof candidate.language === "string" ? { language: candidate.language } : {}),
      ...(typeof candidate.translation_status === "string"
        ? { translation_status: candidate.translation_status }
        : {}),
    });
  }
  return { tokens };
}

function seconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value / 1_000 : 0;
}

export function sonioxTranscriptToArtifacts(transcript: SonioxTranscript): {
  raw: string;
  segments: SonioxSegment[];
} {
  const original = transcript.tokens.filter((token) => token.translation_status !== "translation");
  const segments: SonioxSegment[] = [];
  for (const token of original) {
    if (!token.text) continue;
    const speaker = token.speaker === undefined ? undefined : String(token.speaker);
    const previous = segments.at(-1);
    if (previous && previous.speaker === speaker) {
      previous.text += token.text;
      previous.end = Math.max(previous.end, seconds(token.end_ms));
      continue;
    }
    const start = seconds(token.start_ms);
    segments.push({
      start,
      end: Math.max(start, seconds(token.end_ms)),
      text: token.text,
      ...(speaker ? { speaker } : {}),
    });
  }

  for (const segment of segments) segment.text = segment.text.trim();
  const nonEmpty = segments.filter((segment) => segment.text.length > 0);
  if (nonEmpty.length === 0) throw new Error("soniox_empty_transcript");
  const raw = nonEmpty.map((segment) =>
    segment.speaker ? `화자 ${segment.speaker}: ${segment.text}` : segment.text).join("\n\n") + "\n";
  return { raw, segments: nonEmpty };
}

async function deleteResource(path: string): Promise<void> {
  try {
    await sonioxFetch(path, { method: "DELETE" });
  } catch {
    // Best effort. A later cleanup can retry from the persisted remote ids.
  }
}

export async function cleanupSonioxResources(ids: Partial<SonioxJobIds>): Promise<void> {
  if (process.env.FAKE_SONIOX === "1") return;
  if (ids.transcriptionId && ID_PATTERN.test(ids.transcriptionId)) {
    await deleteResource(`/transcriptions/${encodeURIComponent(ids.transcriptionId)}`);
  }
  if (ids.fileId && ID_PATTERN.test(ids.fileId)) {
    await deleteResource(`/files/${encodeURIComponent(ids.fileId)}`);
  }
}
