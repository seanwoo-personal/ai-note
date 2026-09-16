import type { RoomDocument, RoomEvent, RoomLanguage, RoomRole } from "@/domain/room";

// Pure projections of a room's event log into the two persisted artifacts and
// the per-participant download. No LLM here: the transcript is a faithful
// record of what was said and how it was translated.

export const ROOM_LANGUAGE_LABELS: Record<RoomLanguage, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
};

export interface RoomUtteranceView {
  utteranceId: string;
  seq: number;
  at: string;
  speaker: RoomRole;
  speakerName: string;
  sourceLanguage: string;
  original: string;
  translations: Partial<Record<RoomLanguage, string>>;
  confidence: "high" | "medium" | "low";
}

/** Fold the log into ordered utterances with their latest translations and attribution. */
export function projectRoomUtterances(room: RoomDocument, events: RoomEvent[]): RoomUtteranceView[] {
  const names: Record<RoomRole, string> = { host: "호스트", guest: "게스트" };
  for (const participant of room.participants) names[participant.role] = participant.name;
  const byId = new Map<string, RoomUtteranceView>();
  for (const event of events) {
    if (event.type === "utterance") {
      byId.set(event.utteranceId, {
        utteranceId: event.utteranceId,
        seq: event.seq,
        at: event.at,
        speaker: event.speaker,
        speakerName: names[event.speaker],
        sourceLanguage: event.sourceLanguage,
        original: event.original,
        translations: {},
        confidence: event.confidence,
      });
    } else if (event.type === "translation") {
      const view = byId.get(event.utteranceId);
      if (view) view.translations[event.language] = event.text;
    } else if (event.type === "attribution") {
      const view = byId.get(event.utteranceId);
      if (view) {
        view.speaker = event.speaker;
        view.speakerName = names[event.speaker];
        view.confidence = "high";
      }
    }
  }
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

function languageLabel(code: string): string {
  return (ROOM_LANGUAGE_LABELS as Record<string, string>)[code] ?? code;
}

/** Bilingual transcript. The reader's language (when given) is listed right after the original. */
export function buildRoomTranscript(room: RoomDocument, events: RoomEvent[], readerLanguage?: RoomLanguage): string {
  const blocks: string[] = [];
  for (const utterance of projectRoomUtterances(room, events)) {
    const lines = [`${utterance.speakerName} (${languageLabel(utterance.sourceLanguage)})`];
    lines.push(`- ${languageLabel(utterance.sourceLanguage)}: ${utterance.original}`);
    const ordered = Object.entries(utterance.translations) as Array<[RoomLanguage, string]>;
    ordered.sort(([left], [right]) => {
      if (left === readerLanguage) return -1;
      if (right === readerLanguage) return 1;
      return left.localeCompare(right, "en");
    });
    for (const [language, text] of ordered) {
      if (language === utterance.sourceLanguage) continue;
      lines.push(`- ${languageLabel(language)}: ${text}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n").trim();
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function roomDurationLabel(startedAt: string, endedAt: string): string {
  const elapsed = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  return elapsed < 60_000 ? "1분 미만" : `${Math.ceil(elapsed / 60_000)}분`;
}

export function buildRoomDefaultTitle(room: RoomDocument, events: RoomEvent[], endedAt: string): string {
  const first = projectRoomUtterances(room, events)[0]?.original.replace(/[.!?。！？]+$/gu, "").slice(0, 32).trim();
  return `${first || "통역 회의실"} · ${roomDurationLabel(room.createdAt, endedAt)} 미팅`;
}

/** Minutes body (summary.json manual body) written in the host's language perspective. */
export function buildRoomMinutes(room: RoomDocument, events: RoomEvent[], endedAt: string): string {
  const host = room.participants.find((item) => item.role === "host")!;
  const guest = room.participants.find((item) => item.role === "guest") ?? null;
  const utterances = projectRoomUtterances(room, events);
  const header = [
    `${room.title?.trim() || buildRoomDefaultTitle(room, events, endedAt)} · 통역 회의실 회의록`,
    `일시: ${formatDateTime(room.createdAt)}`,
    `회의 시간: ${roomDurationLabel(room.createdAt, endedAt)}`,
    `참가자: ${[host, guest].filter(Boolean).map((item) => `${item!.name} (${languageLabel(item!.language)})`).join(", ")}`,
    `발화 수: ${utterances.length}건`,
  ].join("\n");
  const bullets = utterances.map((utterance) => {
    const text = utterance.sourceLanguage === host.language
      ? utterance.original
      : utterance.translations[host.language] ?? utterance.original;
    return `- ${utterance.speakerName}: ${text}`;
  }).join("\n");
  return `${header}\n\n주요 발화\n${bullets}`.trim();
}
