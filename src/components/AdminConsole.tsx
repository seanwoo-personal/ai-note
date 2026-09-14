"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { BrandWordmark } from "@/components/BrandWordmark";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/AccessShell";

type Role = "super_admin" | "operator";
type Usage = { login: number; recording: number; summary: number; realtime_session: number; translation: number };
interface Customer {
  id: string;
  email: string;
  name: string;
  companyName: string;
  access: "pending_approval" | "payment_required" | "active" | "blocked";
  billingStatus: "unpaid" | "paid" | "overdue";
  plan: "jpy" | "usd";
  monthlyPrice: number;
  currency: "JPY" | "USD";
  createdAt: string;
  lastLoginAt: string | null;
  usage: Usage;
}
interface Operator { id: string; email: string; name: string; role: Role; lastLoginAt: string | null }
interface Overview { currentOperator: Operator; customers: Customer[]; operators: Operator[] }

const accessLabel: Record<Customer["access"], string> = {
  pending_approval: "승인 대기",
  payment_required: "결제 확인 필요",
  active: "사용 가능",
  blocked: "차단됨",
};

const accessTone: Record<Customer["access"], string> = {
  pending_approval: "bg-warnBg text-warn",
  payment_required: "bg-warnBg text-warn",
  active: "bg-successBg text-success",
  blocked: "bg-[var(--ld-color-bg-danger-e1)] text-error",
};

function formatPlan(customer: Customer) {
  return customer.currency === "JPY"
    ? `월 ${customer.monthlyPrice.toLocaleString("ja-JP")}엔`
    : `월 ${customer.monthlyPrice.toFixed(1)}달러`;
}

export function AdminConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/admin/login");
      return;
    }
    if (!response.ok) throw new Error("overview_failed");
    setOverview(await response.json() as Overview);
  }, []);

  useEffect(() => {
    void load().catch(() => setMessage("운영 현황을 불러오지 못했습니다. 다시 시도해 주세요."));
  }, [load]);

  const metrics = useMemo(() => {
    const customers = overview?.customers ?? [];
    return {
      pending: customers.filter((item) => item.access === "pending_approval").length,
      active: customers.filter((item) => item.access === "active").length,
      billing: customers.filter((item) => item.billingStatus !== "paid").length,
      usage: customers.reduce((sum, item) => sum + item.usage.recording + item.usage.summary + item.usage.realtime_session, 0),
    };
  }, [overview]);

  const mutate = async (customerId: string, action: string) => {
    setBusyId(customerId);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("mutation_failed");
      await load();
      setMessage("계정 상태를 반영했습니다.");
    } catch {
      setMessage("계정 상태를 바꾸지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusyId(null);
    }
  };

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSetupUrl(null);
    try {
      const response = await fetch("/api/admin/operators/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const body = await response.json().catch(() => null) as { setupUrl?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.setupUrl) {
        setMessage(body?.error?.message ?? "운영자 초대 링크를 만들지 못했습니다.");
        return;
      }
      setSetupUrl(body.setupUrl);
      form.reset();
    } catch {
      setMessage("운영자 초대 서버에 연결하지 못했습니다.");
    }
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    window.location.assign("/admin/login");
  };

  return (
    <main id="main" className="min-h-screen bg-bg">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1520px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-5"><BrandWordmark compact /><span className="hidden h-8 w-px bg-line sm:block" /><div><p className="text-[12px] font-semibold text-accent">운영자 콘솔</p><p className="text-[13px] text-inkSoft">승인 · 과금 · 사용량</p></div></div>
          <div className="flex items-center gap-3"><p className="hidden text-right text-[12px] text-inkSoft sm:block"><strong className="block text-ink">{overview?.currentOperator.name ?? "운영자"}</strong>{overview?.currentOperator.email}</p><button type="button" onClick={logout} className={secondaryButtonClass}>로그아웃</button></div>
        </div>
      </header>

      <div className="mx-auto max-w-[1520px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[12px] font-semibold tracking-[.1em] text-accent">OPERATIONS</p><h1 className="mt-2 text-[32px] font-bold tracking-tight">고객 계정 운영 현황</h1><p className="mt-2 text-[14px] text-inkSoft">승인과 결제가 모두 확인된 계정만 기존 AI 노트 화면에 접근합니다.</p></div><button type="button" onClick={() => void load()} className={secondaryButtonClass}>새로고침</button></div>
        {message && <p role="status" className="mt-5 rounded-lg border border-line bg-panel px-4 py-3 text-[13px] text-inkSoft">{message}</p>}

        <section aria-label="핵심 지표" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[["승인 대기", metrics.pending], ["사용 가능", metrics.active], ["결제 확인 필요", metrics.billing], ["누적 핵심 사용", metrics.usage]].map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-panel p-5"><p className="text-[12px] font-semibold text-inkSoft">{label}</p><p className="mt-2 text-[30px] font-bold tabular-nums">{value}</p></div>)}
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between"><div><h2 className="text-[22px] font-bold">고객 계정</h2><p className="mt-1 text-[13px] text-inkSoft">결제 상태를 미결제 또는 연체로 바꾸면 기존 로그인 세션도 즉시 무효화됩니다.</p></div></div>
          <div className="mt-4 grid gap-4">
            {(overview?.customers ?? []).length === 0 && <div className="rounded-xl border border-dashed border-inkFaint bg-panel p-8 text-center text-[14px] text-inkSoft">아직 회원가입 신청이 없습니다.</div>}
            {(overview?.customers ?? []).map((customer) => (
              <article key={customer.id} className="rounded-xl border border-line bg-panel p-5 sm:p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[18px] font-bold">{customer.companyName}</h3><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${accessTone[customer.access]}`}>{accessLabel[customer.access]}</span><span className="rounded-full bg-soft px-2.5 py-1 text-[11px] font-semibold text-accent">{formatPlan(customer)}</span></div><p className="mt-2 text-[13px] text-inkSoft">{customer.name} · {customer.email}</p><p className="mt-1 text-[12px] text-inkSoft">신청 {new Date(customer.createdAt).toLocaleString("ko-KR")} · 최근 로그인 {customer.lastLoginAt ? new Date(customer.lastLoginAt).toLocaleString("ko-KR") : "없음"}</p></div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:max-w-2xl xl:justify-end">
                    {customer.access === "pending_approval" && <button disabled={busyId === customer.id} onClick={() => void mutate(customer.id, "approve")} className={secondaryButtonClass}>가입 승인</button>}
                    {customer.billingStatus !== "paid" ? <button disabled={busyId === customer.id} onClick={() => void mutate(customer.id, "billing_paid")} className={secondaryButtonClass}>결제 완료</button> : <button disabled={busyId === customer.id} onClick={() => void mutate(customer.id, "billing_unpaid")} className={secondaryButtonClass}>미결제 전환</button>}
                    <button disabled={busyId === customer.id} onClick={() => void mutate(customer.id, customer.plan === "jpy" ? "plan_usd" : "plan_jpy")} className={secondaryButtonClass}>{customer.plan === "jpy" ? "달러 요금제로" : "엔 요금제로"}</button>
                    {customer.access === "blocked" ? <button disabled={busyId === customer.id} onClick={() => void mutate(customer.id, "unblock")} className={secondaryButtonClass}>차단 해제</button> : <button disabled={busyId === customer.id} onClick={() => void mutate(customer.id, "block")} className="flex min-h-11 items-center justify-center rounded-lg border border-error/30 px-4 text-[13px] font-semibold text-error">계정 차단</button>}
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-5 sm:grid-cols-5">
                  {[["로그인", customer.usage.login], ["회의 녹음", customer.usage.recording], ["요약", customer.usage.summary], ["실시간 세션", customer.usage.realtime_session], ["번역", customer.usage.translation]].map(([label, value]) => <div key={label} className="rounded-lg bg-bg px-3 py-2"><dt className="text-[11px] text-inkSoft">{label}</dt><dd className="mt-1 text-[16px] font-bold tabular-nums">{value}</dd></div>)}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-5 xl:grid-cols-[1fr_1.05fr]">
          <div className="rounded-xl border border-line bg-panel p-5 sm:p-6"><h2 className="text-[20px] font-bold">운영자 계정</h2><p className="mt-2 text-[13px] text-inkSoft">공개 가입 없이 일회용 초대 링크와 2단계 인증으로만 발급합니다.</p><ul className="mt-5 divide-y divide-line">{(overview?.operators ?? []).map((operator) => <li key={operator.id} className="flex items-center justify-between gap-4 py-3"><span className="min-w-0"><strong className="block truncate text-[14px]">{operator.name}</strong><span className="block truncate text-[12px] text-inkSoft">{operator.email}</span></span><span className="rounded-full bg-soft px-2 py-1 text-[11px] font-semibold text-accent">{operator.role === "super_admin" ? "최고 운영자" : "운영자"}</span></li>)}</ul></div>
          <div className="rounded-xl border border-line bg-panel p-5 sm:p-6"><h2 className="text-[20px] font-bold">새 운영자 초대</h2>{overview?.currentOperator.role === "super_admin" ? <><p className="mt-2 text-[13px] text-inkSoft">24시간 동안 한 번만 쓸 수 있는 설정 링크를 발급합니다.</p><form onSubmit={invite} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-[13px] font-semibold">이름<input className={inputClass} name="name" required /></label><label className="text-[13px] font-semibold">이메일<input className={inputClass} type="email" name="email" required /></label><button className={`${primaryButtonClass} sm:col-span-2`} type="submit">초대 링크 발급</button></form>{setupUrl && <div className="mt-4 rounded-lg bg-bg p-4"><p className="text-[12px] font-semibold text-inkSoft">한 번만 전달할 설정 링크</p><p className="mt-2 break-all font-mono text-[12px]">{setupUrl}</p><button type="button" onClick={() => void navigator.clipboard.writeText(setupUrl)} className={`${secondaryButtonClass} mt-3`}>링크 복사</button></div>}</> : <p className="mt-4 text-[13px] text-inkSoft">최고 운영자만 새 운영자 초대를 발급할 수 있습니다.</p>}</div>
        </section>
      </div>
    </main>
  );
}
