"use client";

import { useEffect, useState } from "react";

interface SessionAccount {
  name: string;
  email: string;
  companyName: string | null;
  plan: "jpy" | "usd" | null;
  monthlyPrice: number | null;
  currency: "JPY" | "USD" | null;
}

export function AccountSummary() {
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body: { account?: SessionAccount } | null) => setAccount(body?.account ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const logout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    window.location.assign("/login");
  };

  if (!account) return null;
  const plan = account.currency === "JPY" && account.monthlyPrice !== null
    ? `월 ${account.monthlyPrice.toLocaleString("ja-JP")}엔`
    : account.currency === "USD" && account.monthlyPrice !== null
      ? `월 ${account.monthlyPrice.toFixed(1)}달러`
      : null;

  return (
    <div className="border-t border-line px-4 py-4" data-i18n-user-content>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{account.companyName ?? account.name}</p>
          <p className="mt-1 truncate text-[11px] text-inkSoft">{account.email}</p>
          {plan && <p className="mt-2 inline-flex rounded-full bg-panel px-2 py-1 text-[10px] font-semibold text-accent">{plan} · 사용 가능</p>}
        </div>
        <button type="button" onClick={logout} disabled={loggingOut} className="min-h-11 shrink-0 rounded-lg px-2 text-[11px] font-semibold text-inkSoft hover:bg-panel hover:text-ink disabled:opacity-50">
          {loggingOut ? "처리 중" : "로그아웃"}
        </button>
      </div>
    </div>
  );
}
