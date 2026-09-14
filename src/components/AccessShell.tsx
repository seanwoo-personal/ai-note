import Link from "next/link";
import type { ReactNode } from "react";

import { BrandWordmark } from "@/components/BrandWordmark";

export function AccessShell({
  children,
  eyebrow,
  title,
  description,
  secondary,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  secondary?: ReactNode;
}) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[minmax(0,0.92fr)_minmax(32rem,1.08fr)]">
      <section className="flex min-h-[18rem] flex-col justify-between border-b border-line bg-chrome px-6 py-8 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-14 lg:py-12">
        <Link href="/login" aria-label="Vision AI 미팅 에이전트 로그인" className="inline-flex w-fit min-h-11 items-center">
          <BrandWordmark />
        </Link>
        <div className="max-w-xl py-10 lg:py-0">
          <p className="mb-4 text-[12px] font-semibold tracking-[0.12em] text-accent">{eyebrow}</p>
          <h1 className="text-[32px] font-bold leading-tight tracking-tight sm:text-[42px]">{title}</h1>
          <p className="mt-5 max-w-lg text-[15px] leading-7 text-inkSoft">{description}</p>
          <ul className="mt-8 grid gap-3 text-[14px] text-inkSoft">
            <li className="rounded-lg border border-line bg-panel/80 px-4 py-3">회의 녹음과 실시간 전사를 한 화면에서 사용해요.</li>
            <li className="rounded-lg border border-line bg-panel/80 px-4 py-3">글로벌 미팅 번역과 음성 입력 기능을 그대로 제공해요.</li>
            <li className="rounded-lg border border-line bg-panel/80 px-4 py-3">승인과 결제가 확인된 고객만 업무 공간에 들어갈 수 있어요.</li>
          </ul>
        </div>
        <p className="text-[12px] leading-5 text-inkSoft">고객 데이터 보호를 위해 계정 상태를 로그인할 때마다 확인합니다.</p>
      </section>
      <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="w-full max-w-xl">
          {children}
          {secondary && <div className="mt-5">{secondary}</div>}
        </div>
      </section>
    </main>
  );
}

export function AccessCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-panel p-6 shadow-[0_18px_50px_-32px_rgba(16,16,14,.35)] sm:p-8">{children}</div>;
}

export const inputClass = "mt-2 min-h-12 w-full rounded-lg border border-inkFaint bg-bg px-4 text-[14px] text-ink outline-none placeholder:text-inkFaint focus:border-accent";
export const primaryButtonClass = "ld-action-primary flex min-h-12 w-full items-center justify-center rounded-lg px-5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButtonClass = "flex min-h-11 items-center justify-center rounded-lg border border-line bg-panel px-4 text-[13px] font-semibold text-accent hover:bg-soft";
