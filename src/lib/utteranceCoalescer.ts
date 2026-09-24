// Merges breath-broken transcription endpoints into sentence-sized utterances
// before they are committed to the room log. Soniox ends an utterance at every
// silence, so "그래서 제가 어제 | 고객사에 다녀왔습니다." arrived as two fragments
// and was translated as two. A fragment is held until it ends a sentence, the
// speaker or language changes, a hold window passes, or the buffer grows too
// large; the pieces are then submitted as one utterance.

export interface EndpointChunk {
  id: number;
  /** Buffer key: diarization label (or a stable fallback) — one buffer per speaker. */
  key: string;
  speakerLabel: string | null;
  language: string;
  original: string;
  translation: string;
  /** Language of `translation` (the other seat's), used only for join spacing. */
  translationLanguage: string | null;
  codeSwitched: boolean;
  at: number;
}

export interface CoalescedUtterance {
  ids: number[];
  key: string;
  speakerLabel: string | null;
  language: string;
  original: string;
  translation: string;
  codeSwitched: boolean;
}

export interface CoalescerOptions {
  /** Ms a non-terminal fragment waits for its continuation. */
  holdMs: number;
  /** Buffer size that forces a commit even mid-sentence. */
  maxChars: number;
}

const TERMINAL = /[.!?。！？…]+[\s"'”’」』)\]]*$/u;
const NO_SPACE_LANGUAGES = new Set(["ja", "zh"]);

export function isSentenceTerminal(text: string): boolean {
  return TERMINAL.test(text.trim());
}

function join(language: string, left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return NO_SPACE_LANGUAGES.has(language) ? `${left}${right}` : `${left} ${right}`;
}

interface Buffer extends CoalescedUtterance {
  since: number;
}

export class UtteranceCoalescer {
  private readonly buffers = new Map<string, Buffer>();

  constructor(private readonly options: CoalescerOptions) {}

  /** Add one endpoint; returns the utterances that became complete because of it. */
  push(chunk: EndpointChunk): CoalescedUtterance[] {
    const commits: CoalescedUtterance[] = [];
    const original = chunk.original.trim();
    if (!original) return commits;
    // Another speaker finishing a thought ends everyone else's pending fragment.
    for (const [key, buffer] of this.buffers) {
      if (key !== chunk.key || buffer.language !== chunk.language) {
        this.buffers.delete(key);
        commits.push(strip(buffer));
      }
    }
    const existing = this.buffers.get(chunk.key);
    const merged: Buffer = existing
      ? {
        ...existing,
        ids: [...existing.ids, chunk.id],
        original: join(chunk.language, existing.original, original),
        translation: join(chunk.translationLanguage ?? "en", existing.translation, chunk.translation.trim()),
        codeSwitched: existing.codeSwitched || chunk.codeSwitched,
        speakerLabel: chunk.speakerLabel ?? existing.speakerLabel,
      }
      : {
        ids: [chunk.id],
        key: chunk.key,
        speakerLabel: chunk.speakerLabel,
        language: chunk.language,
        original,
        translation: chunk.translation.trim(),
        codeSwitched: chunk.codeSwitched,
        since: chunk.at,
      };
    if (isSentenceTerminal(merged.original) || merged.original.length >= this.options.maxChars) {
      this.buffers.delete(chunk.key);
      commits.push(strip(merged));
    } else {
      this.buffers.set(chunk.key, merged);
    }
    return commits;
  }

  /** Commit fragments whose hold window has elapsed. */
  flushStale(now: number): CoalescedUtterance[] {
    const commits: CoalescedUtterance[] = [];
    for (const [key, buffer] of this.buffers) {
      if (now - buffer.since >= this.options.holdMs) {
        this.buffers.delete(key);
        commits.push(strip(buffer));
      }
    }
    return commits;
  }

  flushAll(): CoalescedUtterance[] {
    const commits = [...this.buffers.values()].map(strip);
    this.buffers.clear();
    return commits;
  }

  pendingCount(): number {
    return this.buffers.size;
  }

  /** Earliest time a pending fragment will be flushed, or null when nothing is pending. */
  nextDeadline(): number | null {
    let deadline: number | null = null;
    for (const buffer of this.buffers.values()) {
      const due = buffer.since + this.options.holdMs;
      if (deadline === null || due < deadline) deadline = due;
    }
    return deadline;
  }
}

function strip(buffer: Buffer): CoalescedUtterance {
  return {
    ids: buffer.ids,
    key: buffer.key,
    speakerLabel: buffer.speakerLabel,
    language: buffer.language,
    original: buffer.original,
    translation: buffer.translation,
    codeSwitched: buffer.codeSwitched,
  };
}
