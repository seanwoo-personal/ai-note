"use client";

import { useOptionalAppPreferences } from "@/components/AppPreferences";
import { translateUi } from "@/lib/i18n";
import {
  CURRENT_PRODUCT_VERSION,
  PRODUCT_RELEASES,
  PRODUCT_UPDATE_COUNT,
} from "@/lib/releases";

export function ReleaseNotes() {
  const preferences = useOptionalAppPreferences();
  const t = preferences?.t ?? ((source: string, values = {}) => translateUi("ko", source, values));
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6" aria-labelledby="release-notes-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="release-notes-heading" className="text-[18px] font-bold text-ink">릴리즈 노트</h2>
          <p className="mt-2 text-[13px] leading-6 text-inkSoft">
            최초 AI NOTE 오픈소스를 1.0으로 두고, 사용자에게 전달된 제품 기능 묶음마다 마이너 버전을 한 번 올립니다.
            문서·병합·테스트 전용 커밋은 별도 버전으로 세지 않습니다.
          </p>
        </div>
        <div className="rounded-xl border border-accent/30 bg-soft px-4 py-3 text-right">
          <p className="text-[12px] font-semibold text-inkSoft">현재 버전</p>
          <p className="mt-1 font-mono text-[18px] font-bold text-accent">v{CURRENT_PRODUCT_VERSION}</p>
          <p className="mt-1 text-[12px] text-inkSoft">{t("기준판 이후 {count}회 업데이트", { count: PRODUCT_UPDATE_COUNT })}</p>
        </div>
      </div>

      <ol className="mt-6 space-y-5">
        {PRODUCT_RELEASES.map((release, index) => (
          <li key={release.version} className="relative border-l-2 border-line pl-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[16px] font-bold text-ink">
                v{release.version} · {release.title}
              </h3>
              <time dateTime={release.date} className="font-mono text-[12px] text-inkSoft">{release.date}</time>
              {index === 0 && (
                <span className="rounded-full bg-successBg px-2 py-1 text-[11px] font-bold text-success">현재</span>
              )}
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-6 text-inkSoft">
              {release.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
