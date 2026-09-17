import type { RoomEvent, RoomLanguage, RoomRole } from "@/domain/room";

// Client-side view model for a shared interpreter room: fold SSE events into
// ordered utterances and decide, per participant perspective, which text is
// primary (what I read) and which is the check line (how my words reached them).

export interface RoomViewParticipant {
  role: RoomRole;
  name: string;
  language: RoomLanguage;
  registered?: boolean;
}

export interface RoomViewUtterance {
  utteranceId: string;
  seq: number;
  at: string;
  speaker: RoomRole;
  sourceLanguage: string;
  original: string;
  translations: Partial<Record<RoomLanguage, string>>;
  confidence: "high" | "medium" | "low";
  corrected: boolean;
}

export interface RoomViewState {
  lastSeq: number;
  utterances: RoomViewUtterance[];
  participants: RoomViewParticipant[];
  endedAt: string | null;
}

export function emptyRoomView(participants: RoomViewParticipant[] = [], endedAt: string | null = null): RoomViewState {
  return { lastSeq: 0, utterances: [], participants, endedAt };
}

export function applyRoomEvent(state: RoomViewState, event: RoomEvent): RoomViewState {
  if (event.seq <= state.lastSeq) return state;
  const next: RoomViewState = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case "utterance": {
      if (state.utterances.some((item) => item.utteranceId === event.utteranceId)) return next;
      next.utterances = [...state.utterances, {
        utteranceId: event.utteranceId,
        seq: event.seq,
        at: event.at,
        speaker: event.speaker,
        sourceLanguage: event.sourceLanguage,
        original: event.original,
        translations: {},
        confidence: event.confidence,
        corrected: false,
      }];
      return next;
    }
    case "translation":
      next.utterances = state.utterances.map((item) => item.utteranceId === event.utteranceId
        ? { ...item, translations: { ...item.translations, [event.language]: event.text } }
        : item);
      return next;
    case "attribution":
      next.utterances = state.utterances.map((item) => item.utteranceId === event.utteranceId
        ? { ...item, speaker: event.speaker, confidence: "high", corrected: true }
        : item);
      return next;
    case "participant": {
      const others = state.participants.filter((item) => item.role !== event.role);
      const previous = state.participants.find((item) => item.role === event.role);
      const registered = event.state === "registered" ? true : event.state === "joined" ? previous?.registered ?? false : previous?.registered;
      next.participants = [...others, { role: event.role, name: event.name, language: event.language, registered }]
        .sort((left, right) => (left.role === "host" ? -1 : 1) - (right.role === "host" ? -1 : 1));
      return next;
    }
    case "ended":
      next.endedAt = event.endedAt;
      return next;
  }
}

export interface UtterancePerspective {
  mine: boolean;
  speakerName: string;
  /** What this participant reads first: my own original, or the other's words in my language. */
  primary: string;
  primaryLanguage: string;
  /** For my utterance: the translation the other side received. For theirs: their original. */
  secondary: string | null;
  secondaryLanguage: string | null;
  secondaryPending: boolean;
}

export function utterancePerspective(
  utterance: RoomViewUtterance,
  me: RoomViewParticipant,
  participants: RoomViewParticipant[],
): UtterancePerspective {
  const other = participants.find((item) => item.role !== me.role) ?? null;
  const speaker = participants.find((item) => item.role === utterance.speaker);
  const speakerName = speaker?.name ?? (utterance.speaker === "host" ? "호스트" : "게스트");
  const mine = utterance.speaker === me.role;
  if (mine) {
    const otherLanguage = other?.language ?? null;
    const delivered = otherLanguage && otherLanguage !== utterance.sourceLanguage
      ? utterance.translations[otherLanguage] ?? null
      : null;
    return {
      mine: true,
      speakerName,
      primary: utterance.original,
      primaryLanguage: utterance.sourceLanguage,
      secondary: delivered,
      secondaryLanguage: otherLanguage,
      secondaryPending: Boolean(otherLanguage && otherLanguage !== utterance.sourceLanguage && !delivered),
    };
  }
  const inMyLanguage = utterance.sourceLanguage === me.language
    ? utterance.original
    : utterance.translations[me.language] ?? null;
  return {
    mine: false,
    speakerName,
    primary: inMyLanguage ?? utterance.original,
    primaryLanguage: inMyLanguage ? me.language : utterance.sourceLanguage,
    secondary: inMyLanguage && utterance.sourceLanguage !== me.language ? utterance.original : null,
    secondaryLanguage: utterance.sourceLanguage !== me.language ? utterance.sourceLanguage : null,
    secondaryPending: !inMyLanguage,
  };
}
