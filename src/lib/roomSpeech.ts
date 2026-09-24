import type { RoomRole } from "@/domain/room";
import type { RoomViewParticipant, RoomViewUtterance } from "@/lib/roomView";

// Spoken interpretation for the shared room: which utterances a participant
// should hear read aloud in their own language. Only the other seat's words,
// only when they were spoken in another language, and each utterance once —
// the first translation that arrives (live or refined) is the one voiced.

export const ROOM_VOICES = ["Maya", "Daniel", "Mina", "Kenji"] as const;
export type RoomVoice = (typeof ROOM_VOICES)[number];

export interface SpeechJob {
  utteranceId: string;
  text: string;
  language: string;
}

export function selectSpeechJobs(
  utterances: RoomViewUtterance[],
  me: Pick<RoomViewParticipant, "role" | "language">,
  spoken: ReadonlySet<string>,
): SpeechJob[] {
  const jobs: SpeechJob[] = [];
  for (const utterance of [...utterances].sort((left, right) => left.seq - right.seq)) {
    if (utterance.speaker === me.role) continue;
    if (utterance.sourceLanguage === me.language) continue;
    if (spoken.has(utterance.utteranceId)) continue;
    const text = utterance.translations[me.language]?.trim();
    if (!text) continue;
    jobs.push({ utteranceId: utterance.utteranceId, text, language: me.language });
  }
  return jobs;
}

export function isOtherSeat(speaker: RoomRole, role: RoomRole): boolean {
  return speaker !== role;
}
