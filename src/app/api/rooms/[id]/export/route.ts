import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { ROOM_LANGUAGES, type RoomLanguage } from "@/domain/room";
import { summarySchema } from "@/domain/summarySchema";
import { recordRequestUsage } from "@/lib/accountUsage";
import { readArtifactPair } from "@/lib/artifactPair";
import { atomicWriteFile } from "@/lib/atomicWrite";
import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { publicErrorResponse } from "@/lib/publicApi";
import { resolveRoomRequest } from "@/lib/roomApi";
import { renderRoomDocx, renderRoomPrintHtml } from "@/lib/roomDocuments";
import { buildRoomTranscript, ROOM_LANGUAGE_LABELS } from "@/lib/roomExport";
import { readRoomEvents, roomPaths } from "@/lib/roomStore";
import { summaryBodyFromSummary } from "@/lib/summaryBody";
import { translateText } from "@/lib/translation";

// GET /api/rooms/[id]/export?kind=transcript|minutes&language=…&format=md|docx|html
// One content source (plain text), three deliveries: Markdown attachment, Word
// document, or a print page (the browser saves it as PDF; also the preview).
// Minutes in a language other than the host's are translated once and cached
// as `summary.{lang}.md`; canonical summary.json is never modified.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  kind: z.enum(["transcript", "minutes"]),
  language: z.enum(ROOM_LANGUAGES).optional(),
  format: z.enum(["md", "docx", "html"]).default("md"),
});

const PRINT_HINT: Record<RoomLanguage, string> = {
  ko: "인쇄 · PDF로 저장",
  en: "Print · Save as PDF",
  ja: "印刷・PDFとして保存",
  zh: "打印 · 保存为 PDF",
};

const KIND_LABEL: Record<"transcript" | "minutes", Record<RoomLanguage, string>> = {
  transcript: { ko: "대화록", en: "Transcript", ja: "会話記録", zh: "对话记录" },
  minutes: { ko: "회의록", en: "Minutes", ja: "議事録", zh: "会议纪要" },
};

function attachment(body: string | Uint8Array, contentType: string, filename: string, inline = false): Response {
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const context = await resolveRoomRequest(request, (await params).id);
  if (!context.ok) return context.response;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    kind: url.searchParams.get("kind") ?? undefined,
    language: url.searchParams.get("language") ?? undefined,
    format: url.searchParams.get("format") ?? undefined,
  });
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);
  const me = context.room.participants.find((item) => item.role === context.identity.role);
  const language: RoomLanguage = parsed.data.language ?? me?.language ?? "ja";
  const { kind, format } = parsed.data;

  let body: string;
  if (kind === "transcript") {
    const log = await readRoomEvents(context.id);
    if (log.corrupt) return publicErrorResponse("content_state_ambiguous", 409, { meetingId: context.id });
    body = buildRoomTranscript(context.room, log.events, language);
  } else {
    if (context.room.endedAt === null) return publicErrorResponse("meeting_conflict", 409, { meetingId: context.id });
    const pair = await readArtifactPair(context.id);
    if (pair.state !== "stable" || pair.summary === null) return publicErrorResponse("resource_not_found", 404);
    const summary = summarySchema.parse(JSON.parse(pair.summary));
    const hostLanguage = context.room.participants.find((item) => item.role === "host")?.language ?? "ja";
    const hostBody = summaryBodyFromSummary(summary);
    if (language === hostLanguage) {
      body = hostBody;
    } else {
      const cachePath = join(roomPaths(context.id).dir, `summary.${language}.md`);
      let cached: string | null = null;
      try {
        cached = await readFile(cachePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          return publicErrorResponse("content_state_ambiguous", 409, { meetingId: context.id });
        }
      }
      if (cached !== null) {
        body = cached.replace(/\n$/u, "");
      } else {
        const translated = await translateText(hostBody, language);
        if (!translated.ok) return publicErrorResponse("cloud_service_unavailable", 503);
        await recordRequestUsage(request, "translation");
        body = translated.translation;
        await atomicWriteFile(cachePath, `${body}\n`);
      }
    }
  }

  const title = `${context.room.title ?? "Vision AI 미팅 에이전트"} · ${KIND_LABEL[kind][language]} (${ROOM_LANGUAGE_LABELS[language]})`;
  const baseName = `room-${context.id}-${kind}-${language}`;
  const generatedAt = formatGeneratedAt(new Date().toISOString());
  if (format === "docx") {
    const buffer = await renderRoomDocx({ title, body, language, generatedAt });
    return attachment(new Uint8Array(buffer), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${baseName}.docx`);
  }
  if (format === "html") {
    const html = renderRoomPrintHtml({ title, body, language, generatedAt }, { printHint: PRINT_HINT[language] });
    return attachment(html, "text/html; charset=utf-8", `${baseName}.html`, true);
  }
  return attachment(`${body}\n`, "text/markdown; charset=utf-8", `${baseName}.md`);
}
