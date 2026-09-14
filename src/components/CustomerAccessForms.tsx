"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { AccessCard, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/AccessShell";
import { useOptionalAppPreferences } from "@/components/AppPreferences";
import type { AppLocale } from "@/lib/appPreferences";

const LOGIN_LANGUAGES = [
  { locale: "ja", label: "日本語" },
  { locale: "en", label: "English" },
  { locale: "ko", label: "한국어" },
] as const satisfies ReadonlyArray<{ locale: AppLocale; label: string }>;

const LOGIN_LANGUAGE_GROUP_LABEL: Record<(typeof LOGIN_LANGUAGES)[number]["locale"], string> = {
  ko: "로그인 화면 언어",
  en: "Login screen language",
  ja: "ログイン画面の言語",
};

function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/admin") ? value : "/";
}

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

function LoginLanguageSwitcher() {
  const preferences = useOptionalAppPreferences();
  const locale = preferences?.locale === "en" || preferences?.locale === "ko" ? preferences.locale : "ja";
  return (
    <div className="mb-6 flex justify-end">
      <div
        role="group"
        aria-label={LOGIN_LANGUAGE_GROUP_LABEL[locale]}
        data-i18n-user-attributes
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-bg p-1"
      >
        {LOGIN_LANGUAGES.map((language) => {
          const selected = locale === language.locale;
          return (
            <button
              key={language.locale}
              type="button"
              aria-pressed={selected}
              onClick={() => preferences?.setLocale(language.locale)}
              className={`min-h-9 rounded-md px-3 text-[12px] font-semibold transition-colors ${selected ? "bg-panel text-accent shadow-sm" : "text-inkSoft hover:text-ink"}`}
            >
              <span data-i18n-user-content>{language.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CustomerLoginForm({ nextPath = "/" }: { nextPath?: string }) {
  const preferences = useOptionalAppPreferences();
  const locale = preferences?.locale === "en" || preferences?.locale === "ko" ? preferences.locale : "ja";
  const guideHref = locale === "en"
    ? "/customer-guide-en.html"
    : locale === "ko"
      ? "/customer-guide-ko.html"
      : "/customer-guide.html";
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      if (!response.ok) {
        setMessage(await responseMessage(response));
        return;
      }
      const body = await response.json().catch(() => null) as { account?: { passwordChangeRequired?: boolean } } | null;
      window.location.assign(body?.account?.passwordChangeRequired ? "/password/change" : safeNext(nextPath));
    } catch {
      setMessage("로그인 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <LoginLanguageSwitcher />
      <p className="text-[12px] font-semibold text-accent">고객 로그인</p>
      <h2 className="mt-2 text-[24px] font-bold tracking-tight">AI 노트를 시작하세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">승인과 결제가 확인된 고객 계정으로 로그인해 주세요.</p>
      {message && <div role="alert" className="mt-5 rounded-lg border border-error/30 bg-[var(--ld-color-bg-danger-e1)] px-4 py-3 text-[13px] leading-5 text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-[13px] font-semibold">이메일<input className={inputClass} type="email" name="email" autoComplete="email" required /></label>
        <label className="block text-[13px] font-semibold">비밀번호<input className={inputClass} type="password" name="password" autoComplete="current-password" required /></label>
        <button className={primaryButtonClass} type="submit" disabled={submitting}>{submitting ? "확인하는 중…" : "AI 노트로 들어가기"}</button>
        <Link href="/forgot-password" className="flex min-h-11 items-center justify-center text-[13px] font-semibold text-accent underline decoration-line underline-offset-4">비밀번호를 잊으셨나요?</Link>
      </form>
      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-inkSoft">아직 계정이 없으신가요?</p>
        <Link href="/signup" className={secondaryButtonClass}>회원가입 신청</Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Link href="/admin/login" className={secondaryButtonClass}>운영자 화면으로 이동</Link>
        <Link href={guideHref} target="_blank" rel="noreferrer" className={secondaryButtonClass}>사용방법 보기</Link>
      </div>
    </AccessCard>
  );
}

export function CustomerForgotPasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email") }),
      });
      if (!response.ok) {
        setMessage(await responseMessage(response));
        return;
      }
      const body = await response.json().catch(() => null) as { message?: string } | null;
      setAccepted(true);
      setMessage(body?.message ?? "가입된 이메일이라면 임시 비밀번호를 발송했습니다.");
    } catch {
      setMessage("메일 발송 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">비밀번호 찾기</p>
      <h2 className="mt-2 text-[24px] font-bold tracking-tight">임시 비밀번호를 받아보세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">가입할 때 사용한 이메일로 30분 동안 유효한 일회용 임시 비밀번호를 보내드립니다.</p>
      {message && <div role={accepted ? "status" : "alert"} className={`mt-5 rounded-lg border px-4 py-3 text-[13px] leading-5 ${accepted ? "border-accent/30 bg-soft text-ink" : "border-error/30 bg-[var(--ld-color-bg-danger-e1)] text-error"}`}>{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-[13px] font-semibold">가입 이메일<input className={inputClass} type="email" name="email" autoComplete="email" required /></label>
        <button className={primaryButtonClass} type="submit" disabled={submitting}>{submitting ? "발송하는 중…" : "임시 비밀번호 받기"}</button>
        <Link href="/login" className="flex min-h-11 items-center justify-center text-[13px] font-semibold text-accent">로그인으로 돌아가기</Link>
      </form>
    </AccessCard>
  );
}

export function CustomerPasswordChangeForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setMessage("새 비밀번호와 확인 값이 일치하지 않습니다.");
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      if (!response.ok) {
        setMessage(await responseMessage(response));
        return;
      }
      window.location.assign("/");
    } catch {
      setMessage("비밀번호 변경 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">새 비밀번호 설정</p>
      <h2 className="mt-2 text-[24px] font-bold tracking-tight">사용할 비밀번호를 새로 정하세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">임시 비밀번호 사용이 확인됐습니다. 새 비밀번호를 설정해야 AI 노트를 계속 사용할 수 있습니다.</p>
      {message && <div role="alert" className="mt-5 rounded-lg border border-error/30 bg-[var(--ld-color-bg-danger-e1)] px-4 py-3 text-[13px] leading-5 text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <div><label htmlFor="customer-next-password" className="block text-[13px] font-semibold">새 비밀번호</label><input id="customer-next-password" className={inputClass} type="password" name="password" autoComplete="new-password" minLength={12} aria-describedby="customer-next-password-hint" required /><span id="customer-next-password-hint" className="mt-2 block text-[12px] font-medium text-inkSoft">12자 이상, 영문·숫자·특수문자를 모두 포함해 주세요.</span></div>
        <div><label htmlFor="customer-next-password-confirmation" className="block text-[13px] font-semibold">새 비밀번호 확인</label><input id="customer-next-password-confirmation" className={inputClass} type="password" name="confirmation" autoComplete="new-password" minLength={12} required /></div>
        <button className={primaryButtonClass} type="submit" disabled={submitting}>{submitting ? "변경하는 중…" : "새 비밀번호로 변경"}</button>
      </form>
    </AccessCard>
  );
}

export function CustomerSignupForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (!response.ok) {
        setMessage(await responseMessage(response));
        return;
      }
      window.location.assign("/signup/success");
    } catch {
      setMessage("신청 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">회원가입 신청</p>
      <h2 className="mt-2 text-[24px] font-bold tracking-tight">사용 신청서를 작성해 주세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">신청 즉시 사용할 수 없어요. 비전 운영자가 고객사와 결제 상태를 확인한 뒤 계정을 활성화합니다.</p>
      {message && <div role="alert" className="mt-5 rounded-lg border border-error/30 bg-[var(--ld-color-bg-danger-e1)] px-4 py-3 text-[13px] text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 grid gap-5 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold sm:col-span-2">회사명<input className={inputClass} name="companyName" autoComplete="organization" maxLength={100} required /></label>
        <label className="block text-[13px] font-semibold">담당자 이름<input className={inputClass} name="contactName" autoComplete="name" maxLength={60} required /></label>
        <label className="block text-[13px] font-semibold">업무 이메일<input className={inputClass} type="email" name="email" autoComplete="email" required /></label>
        <label className="block text-[13px] font-semibold sm:col-span-2">비밀번호<input className={inputClass} type="password" name="password" autoComplete="new-password" minLength={12} required /><span className="mt-2 block text-[12px] font-medium text-inkSoft">12자 이상, 영문·숫자·특수문자를 모두 포함해 주세요.</span></label>
        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] font-semibold">희망 요금제</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg p-4 has-[:checked]:border-accent has-[:checked]:bg-soft"><input type="radio" name="plan" value="jpy" defaultChecked className="mt-1" /><span><strong className="block text-[15px]">월 1,500엔</strong><span className="mt-1 block text-[12px] text-inkSoft">일본 고객사 결제 기준</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg p-4 has-[:checked]:border-accent has-[:checked]:bg-soft"><input type="radio" name="plan" value="usd" className="mt-1" /><span><strong className="block text-[15px]">월 9.9달러</strong><span className="mt-1 block text-[12px] text-inkSoft">달러 결제 기준</span></span></label>
          </div>
        </fieldset>
        <button className={`${primaryButtonClass} sm:col-span-2`} type="submit" disabled={submitting}>{submitting ? "신청하는 중…" : "회원가입 신청하기"}</button>
      </form>
      <Link href="/login" className="mt-5 flex min-h-11 items-center justify-center text-[13px] font-semibold text-accent">로그인으로 돌아가기</Link>
    </AccessCard>
  );
}
