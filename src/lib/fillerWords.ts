// Hesitation sounds ("음", "어", "um", "えーと") that a speaker emits while
// thinking. Realtime STT transcribes them faithfully, which means the translator
// then renders them in the target language and the TTS voice says them out loud
// to the other side. That is noise, not speech, so the outbound broadcast strips
// them before translating and speaking.
//
// The list is deliberately conservative. A filler list that is too eager destroys
// real speech — "어제"(yesterday), "아니요"(no), "그"(that), "뭐"(what),
// "저기"(over there), "umbrella" all begin with something that looks like a
// filler. Two rules keep that from happening:
//   1. Only a WHOLE token may be dropped, never a prefix inside a word.
//   2. Ambiguous words that also carry meaning (그 / 뭐 / 저기 / あの / 那个) are
//      never listed, even though they are used as fillers in practice.

const FILLER_PATTERNS: RegExp[] = [
  /^으?[음흠]+$/u,        // 음, 으음, 흠, 음음
  /^[어에아오]+$/u,        // 어, 어어, 에, 아, 아아
  /^u+[hm]+$/iu,          // um, umm, uh, uhh, uhm
  /^e+r+m*$/iu,           // er, err, erm
  /^h+m+$/iu,             // hm, hmm
  /^m+$/iu,               // mm, mmm
  /^a+h+$/iu,             // ah, ahh
  /^え+ー*と*$/u,          // えー, えーと, ええと
  /^う+ー*ん+$/u,          // うーん, ううん
  /^ん+ー*$/u,             // んー
  /^[呃嗯]+$/u,           // 呃, 嗯
];

// Punctuation and elongation marks that ride along with a hesitation token and
// should disappear with it ("으음...", "아," → dropped whole).
const TRIM_PATTERN = /^[\s.,!?…~ー。，！？"'“”‘’()[\]]+|[\s.,!?…~ー。，！？"'“”‘’()[\]]+$/gu;

function isFiller(token: string): boolean {
  const core = token.replace(TRIM_PATTERN, "");
  if (!core) return false;
  return FILLER_PATTERNS.some((pattern) => pattern.test(core));
}

/**
 * Remove standalone hesitation tokens from an utterance.
 *
 * Returns the input unchanged when it is blank, when it contains no filler, or
 * when it is filler all the way through — an all-hesitation turn has nothing
 * else to broadcast, and sending an empty string downstream would drop the turn
 * entirely rather than merely tidy it.
 */
export function stripFillerWords(text: string): string {
  if (!text.trim()) return text;
  const tokens = text.trim().split(/\s+/u);
  const kept = tokens.filter((token) => !isFiller(token));
  if (kept.length === 0 || kept.length === tokens.length) return text;
  return kept.join(" ");
}
