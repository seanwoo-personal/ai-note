// Pure renderers that turn an in-memory Global Meeting conversation log into the
// two persisted artifacts: a bilingual transcript (transcript.md) and a concise
// Korean-side minutes record (summary.json body). These never call an LLM — they
// are a faithful record of what the live translation produced, not an AI summary.

export interface GlobalMeetingLogEntry {
  speaker: string;
  korean: string;
  counterpart: string;
  direction: "incoming" | "outbound";
}

function usable(entry: GlobalMeetingLogEntry): boolean {
  return entry.korean.trim().length > 0 || entry.counterpart.trim().length > 0;
}

export function buildGlobalMeetingTranscript(
  entries: GlobalMeetingLogEntry[],
  labels: { inputLanguageLabel?: string; targetLanguageLabel?: string } = {},
): string {
  const inputLanguageLabel = labels.inputLanguageLabel?.trim() || "한국어";
  const targetLanguageLabel = labels.targetLanguageLabel?.trim() || "상대";
  const blocks: string[] = [];
  for (const entry of entries) {
    if (!usable(entry)) continue;
    const lines = [entry.speaker];
    if (entry.korean.trim()) lines.push(`- ${inputLanguageLabel}: ${entry.korean.trim()}`);
    if (entry.counterpart.trim()) lines.push(`- ${targetLanguageLabel}: ${entry.counterpart.trim()}`);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n").trim();
}

export interface GlobalMeetingDefaultTitleInput {
  startedAt: string;
  endedAt: string;
  entries: GlobalMeetingLogEntry[];
}

export function buildGlobalMeetingDefaultTitle(input: GlobalMeetingDefaultTitleInput): string {
  const started = new Date(input.startedAt).getTime();
  const ended = new Date(input.endedAt).getTime();
  const elapsedMs = Number.isFinite(started) && Number.isFinite(ended)
    ? Math.max(0, ended - started)
    : 0;
  const durationLabel = elapsedMs < 60_000 ? "1분 미만" : `${Math.ceil(elapsedMs / 60_000)}분`;
  const firstContent = input.entries
    .filter(usable)
    .map((entry) => entry.korean.trim() || entry.counterpart.trim())
    .find(Boolean);
  const topic = firstContent
    ? firstContent.replace(/[.!?。！？]+$/gu, "").slice(0, 32).trim()
    : "글로벌 미팅";
  return `${topic || "글로벌 미팅"} · ${durationLabel} 미팅`;
}

export interface GlobalMeetingMinutesInput {
  title: string;
  startedAt: string;
  endedAt?: string;
  inputLanguageLabel?: string;
  targetLanguageLabel: string;
  entries: GlobalMeetingLogEntry[];
}

function formatStartedAt(startedAtIso: string): string {
  const date = new Date(startedAtIso);
  if (Number.isNaN(date.getTime())) return startedAtIso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildGlobalMeetingMinutes(input: GlobalMeetingMinutesInput): string {
  const populated = input.entries.filter(usable);
  const bullets = populated
    .map((entry) => {
      const text = entry.korean.trim() || entry.counterpart.trim();
      return `- ${entry.speaker}: ${text}`;
    })
    .join("\n");
  const header = [
    `${input.title.trim() || "글로벌 미팅"} · 실시간 번역 회의록`,
    `일시: ${formatStartedAt(input.startedAt)}`,
    `회의 시간: ${buildGlobalMeetingDurationLabel(input.startedAt, input.endedAt ?? input.startedAt)}`,
    `입력 언어: ${input.inputLanguageLabel?.trim() || "한국어"}`,
    `번역할 언어: ${input.targetLanguageLabel}`,
    `발화 수: ${populated.length}건`,
  ].join("\n");
  return `${header}\n\n주요 발화\n${bullets}`.trim();
}

function buildGlobalMeetingDurationLabel(startedAt: string, endedAt: string): string {
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return "알 수 없음";
  const elapsedMs = Math.max(0, ended - started);
  if (elapsedMs < 60_000) return "1분 미만";
  return `${Math.ceil(elapsedMs / 60_000)}분`;
}
