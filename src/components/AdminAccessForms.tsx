"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";

import { AccessCard, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/AccessShell";

interface SetupResult {
  email: string;
  totpSecret: string;
  totpUri: string;
  recoveryCodes: string[];
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "요청을 처리하지 못했습니다.";
}

/** The otpauth URI as an inline SVG data URL; null until rendered or when encoding fails. */
function useTotpQrCode(totpUri: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(totpUri, { type: "svg", errorCorrectionLevel: "M", margin: 1 })
      .then((svg) => { if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [totpUri]);
  return src;
}

function SecurityMaterial({ result, localOnly = false }: { result: SetupResult; localOnly?: boolean }) {
  const qrSrc = useTotpQrCode(result.totpUri);
  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">2단계 인증 등록</p>
      <h2 className="mt-2 text-[24px] font-bold">이 정보는 지금 한 번만 보여드려요</h2>
      <p className="mt-3 text-[14px] leading-6 text-inkSoft">인증 앱으로 QR 코드를 스캔한 뒤 복구 코드를 안전한 암호 관리 도구에 보관해 주세요. 스캔이 어려우면 설정 키를 직접 입력할 수 있어요.</p>
      <dl className="mt-6 space-y-4">
        <div><dt className="text-[12px] font-semibold text-inkSoft">운영자 이메일</dt><dd className="mt-1 break-all rounded-lg bg-bg p-3 font-mono text-[13px]">{result.email}</dd></div>
        <div>
          <dt className="text-[12px] font-semibold text-inkSoft">인증 앱 QR 코드</dt>
          <dd className="mt-1 flex justify-center rounded-lg bg-bg p-3">
            {qrSrc
              ? <img src={qrSrc} alt="인증 앱 QR 코드" width={192} height={192} className="h-48 w-48 rounded bg-white p-2" />
              : <span className="text-[13px] text-inkSoft">QR 코드를 만드는 중…</span>}
          </dd>
        </div>
        <div><dt className="text-[12px] font-semibold text-inkSoft">인증 앱 설정 키 (직접 입력용)</dt><dd className="mt-1 break-all rounded-lg bg-bg p-3 font-mono text-[13px]">{result.totpSecret}</dd></div>
        <div><dt className="text-[12px] font-semibold text-inkSoft">일회용 복구 코드</dt><dd className="mt-1 grid grid-cols-2 gap-2 rounded-lg bg-bg p-3 font-mono text-[12px]">{result.recoveryCodes.map((code) => <span key={code}>{code}</span>)}</dd></div>
      </dl>
      {localOnly ? (
        <div className="mt-6 rounded-lg bg-bg p-4 text-[13px] leading-6 text-inkSoft">
          기존 인증 앱 항목은 모두 삭제하고 지금 발급된 QR 코드 하나만 시간 기반 인증으로 등록하세요. 저장을 마치면 이 로컬 탭을 닫고 공개 HTTPS 운영자 로그인 화면으로 돌아가세요.
        </div>
      ) : (
        <Link href="/admin/login" className={`${primaryButtonClass} mt-6`}>운영자 로그인으로 이동</Link>
      )}
    </AccessCard>
  );
}

export function AdminLoginForm({ nextPath = "/admin" }: { nextPath?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (!response.ok) {
        setMessage(await errorMessage(response));
        return;
      }
      const destination = nextPath.startsWith("/admin") && !nextPath.startsWith("//") ? nextPath : "/admin";
      window.location.assign(destination);
    } catch {
      setMessage("운영자 로그인 서버에 연결하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">운영자 로그인</p>
      <h2 className="mt-2 text-[24px] font-bold">계정 승인과 결제를 관리하세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">비밀번호와 인증 앱의 6자리 코드를 함께 입력해 주세요. 복구 코드도 한 번 사용할 수 있습니다.</p>
      {message && <div role="alert" className="mt-5 rounded-lg border border-error/30 bg-[var(--ld-color-bg-danger-e1)] px-4 py-3 text-[13px] text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-[13px] font-semibold">운영자 이메일<input className={inputClass} type="email" name="email" autoComplete="username" required /></label>
        <label className="block text-[13px] font-semibold">비밀번호<input className={inputClass} type="password" name="password" autoComplete="current-password" required /></label>
        <label className="block text-[13px] font-semibold">인증 코드<input className={inputClass} name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={64} placeholder="6자리 코드 또는 복구 코드" required /></label>
        <button className={primaryButtonClass} type="submit" disabled={submitting}>{submitting ? "확인하는 중…" : "운영자 화면으로 이동"}</button>
      </form>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link href="/login" className={secondaryButtonClass}>고객 로그인</Link>
        <Link href="/admin/setup" className={secondaryButtonClass}>최초 운영자 설정</Link>
      </div>
    </AccessCard>
  );
}

export function AdminSetupForm() {
  const [availability, setAvailability] = useState<"checking" | "open" | "done" | "remote">("checking");
  const [result, setResult] = useState<SetupResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/bootstrap", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { canBootstrap?: boolean; error?: { code?: string } } | null;
        if (response.ok) setAvailability(body?.canBootstrap === true ? "open" : "done");
        else setAvailability(response.status === 403 && body?.error?.code === "invalid_host" ? "remote" : "done");
      })
      .catch(() => setAvailability("done"));
  }, []);

  if (result) return <SecurityMaterial result={result} localOnly />;
  if (availability === "checking") return <AccessCard><p className="text-[14px] text-inkSoft">설정 가능 여부를 확인하는 중…</p></AccessCard>;
  if (availability === "remote") return (
    <AccessCard>
      <h2 className="text-[24px] font-bold">이 화면은 서버 로컬에서만 열려요</h2>
      <p className="mt-3 text-[14px] leading-6 text-inkSoft">최초 운영자는 공개 주소가 아니라 서버의 127.0.0.1 주소로 접속했을 때만 만들 수 있어요. 서버에 SSH 포트 포워딩으로 연결한 뒤 같은 경로를 다시 열어 주세요.</p>
      <Link href="/admin/login" className={`${secondaryButtonClass} mt-6 w-full`}>운영자 로그인</Link>
    </AccessCard>
  );
  if (availability === "done") return (
    <AccessCard>
      <h2 className="text-[24px] font-bold">최초 운영자 설정이 완료되어 있어요</h2>
      <p className="mt-3 text-[14px] leading-6 text-inkSoft">새 운영자는 최고 운영자가 운영자 화면에서 일회용 초대 링크로 발급합니다.</p>
      <Link href="/admin/login" className={`${secondaryButtonClass} mt-6 w-full`}>운영자 로그인</Link>
    </AccessCard>
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (!response.ok) {
        setMessage(await errorMessage(response));
        return;
      }
      setResult(await response.json() as SetupResult);
    } catch {
      setMessage("최초 운영자 설정 서버에 연결하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">최초 1회 설정</p>
      <h2 className="mt-2 text-[24px] font-bold">최고 운영자 계정을 만드세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">운영자 계정이 하나도 없고 로컬에서 실행 중일 때만 열립니다. 이후 운영자는 초대 링크로만 발급합니다.</p>
      {message && <div role="alert" className="mt-5 rounded-lg bg-[var(--ld-color-bg-danger-e1)] p-3 text-[13px] text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-[13px] font-semibold">이름<input className={inputClass} name="name" autoComplete="name" required /></label>
        <label className="block text-[13px] font-semibold">운영자 이메일<input className={inputClass} type="email" name="email" autoComplete="username" required /></label>
        <label className="block text-[13px] font-semibold">비밀번호<input className={inputClass} type="password" name="password" autoComplete="new-password" minLength={12} required /></label>
        <button className={primaryButtonClass} type="submit" disabled={submitting}>{submitting ? "생성하는 중…" : "최고 운영자 생성"}</button>
      </form>
    </AccessCard>
  );
}

export function AdminMfaResetForm() {
  const [result, setResult] = useState<SetupResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (result) return <SecurityMaterial result={result} localOnly />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/mfa-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (!response.ok) {
        setMessage(await errorMessage(response));
        return;
      }
      setResult(await response.json() as SetupResult);
    } catch {
      setMessage("인증 앱 재등록 서버에 연결하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">로컬 전용 MFA 재등록</p>
      <h2 className="mt-2 text-[24px] font-bold">인증 앱을 하나로 다시 설정하세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">운영자 비밀번호를 확인한 뒤 기존 인증 앱 키와 복구 코드를 모두 폐기하고 새 정보만 발급합니다.</p>
      {message && <div role="alert" className="mt-5 rounded-lg bg-[var(--ld-color-bg-danger-e1)] p-3 text-[13px] text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-[13px] font-semibold">운영자 이메일<input className={inputClass} type="email" name="email" autoComplete="username" required /></label>
        <label className="block text-[13px] font-semibold">비밀번호<input className={inputClass} type="password" name="password" autoComplete="current-password" required /></label>
        <button className={primaryButtonClass} type="submit" disabled={submitting}>{submitting ? "재등록하는 중…" : "새 인증 정보 발급"}</button>
      </form>
      <Link href="/admin/login" className={`${secondaryButtonClass} mt-5 w-full`}>취소</Link>
    </AccessCard>
  );
}

export function OperatorAcceptForm({ token }: { token: string }) {
  const [result, setResult] = useState<SetupResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (result) return <SecurityMaterial result={result} />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/operators/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: data.get("password") }),
      });
      if (!response.ok) {
        setMessage(await errorMessage(response));
        return;
      }
      setResult(await response.json() as SetupResult);
    } catch {
      setMessage("운영자 계정 설정 서버에 연결하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <AccessCard>
      <p className="text-[12px] font-semibold text-accent">운영자 초대</p>
      <h2 className="mt-2 text-[24px] font-bold">운영자 계정의 비밀번호를 설정하세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-inkSoft">초대 링크는 한 번만 사용할 수 있고 24시간 뒤 만료됩니다.</p>
      {message && <div role="alert" className="mt-5 rounded-lg bg-[var(--ld-color-bg-danger-e1)] p-3 text-[13px] text-error">{message}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-[13px] font-semibold">새 비밀번호<input className={inputClass} type="password" name="password" autoComplete="new-password" minLength={12} required /></label>
        <button className={primaryButtonClass} type="submit" disabled={submitting || !token}>{submitting ? "설정하는 중…" : "운영자 계정 활성화"}</button>
      </form>
    </AccessCard>
  );
}
