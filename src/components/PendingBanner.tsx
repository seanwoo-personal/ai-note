import { GuardedLink as Link } from "@/components/RecorderNavigation";
import type { LlmReadiness } from "@/components/healthStatus";

// Home backlog banner for meetings transcribed but not yet summarized. The app
// summarizes in-process only when the AI meeting-notes feature is available.
// `count` = meetings the worker will auto-process; `needsAttention` = meetings
// whose auto-summary already failed (worker backed off) — showing those as
// "자동 처리 중" would be a false-green promise, so they get "확인 필요" instead.
export function PendingBanner({
  count,
  needsAttention = 0,
  readiness,
  attention = null,
}: {
  count: number;
  needsAttention?: number;
  readiness: LlmReadiness;
  attention?: { meetingId: string; cursor: string } | null;
}) {
  if (count <= 0 && needsAttention <= 0) return null;

  if (readiness === "ready") {
    const processing = count > 0;
    return (
      <div className="flex flex-col items-stretch gap-3 rounded-[14px] border border-line bg-panel p-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex min-w-0 items-start gap-2 sm:items-center">
          {processing && (
            <span
              className="mt-1.5 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none sm:mt-0"
              aria-hidden="true"
            />
          )}
          <p className="min-w-0 break-words text-[14px] text-ink">
            {processing && (
              <>
                <span className="font-semibold">{count}개 회의</span> 요약 자동 처리 중…
              </>
            )}
            {processing && needsAttention > 0 && " · "}
            {needsAttention > 0 && (
              <span className="font-semibold text-warn">{needsAttention}개 확인 필요</span>
            )}
          </p>
        </div>
        {needsAttention > 0 && attention && (
          <Link
            href={`/meetings/${attention.meetingId}?attentionAfter=${encodeURIComponent(attention.cursor)}`}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-line bg-panel px-3 text-[13px] font-medium text-accent transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:ml-auto sm:w-auto"
          >
            확인할 회의 열기
          </Link>
        )}
      </div>
    );
  }

  const total = count + needsAttention;
  const unavailable = readiness === "unavailable";
  return (
    <div className={`rounded-[14px] border p-4 sm:px-6 ${unavailable ? "border-error/40 bg-error/5" : "border-warn/40 bg-warnBg"}`}>
      <div>
        <p className="min-w-0 break-words text-[14px] text-ink">
          <span className="font-semibold">{total}개 회의가 AI 회의록 작성 대기 중</span> —{" "}
          {unavailable ? "지금은 자동으로 만들 수 없습니다." : "기능을 준비하고 있습니다."}
        </p>
      </div>
      <p className="mt-1.5 text-[13px] text-inkSoft">
        {unavailable
          ? "잠시 후 다시 시도하거나 운영자에게 문의해 주세요. 회의 녹음과 전사 결과는 그대로 보존됩니다."
          : readiness === "loading"
            ? "AI 회의록 기능을 확인하고 있습니다."
            : "준비 전에도 회의 녹음과 전사를 사용할 수 있습니다."}
      </p>
    </div>
  );
}
