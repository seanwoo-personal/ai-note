"use client";

import { useEffect, useState } from "react";

import { useAppPreferences } from "@/components/AppPreferences";
import { BrandWordmark } from "@/components/BrandWordmark";
import { InterpreterRoom } from "@/components/InterpreterRoom";
import { LocaleSwitcher, ROOM_LANGUAGE_GROUP_LABEL } from "@/components/LocaleSwitcher";
import { ROOM_LANGUAGES, type RoomLanguage } from "@/domain/room";
import { ROOM_LANGUAGE_LABELS } from "@/lib/roomExport";

// Guest entry: name + password + language, then the room itself in place.
// A returning guest with a live seat may continue as before or enter again
// under a different name; an unknown or expired link is a dead end, not a form.

type Phase =
  | { kind: "checking" }
  | { kind: "invalid" }
  | { kind: "form" }
  | { kind: "session"; id: string; name: string; language: RoomLanguage }
  | { kind: "room"; id: string };

export function GuestJoinClient({ token }: { token: string }) {
  const { t, locale } = useAppPreferences();
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<RoomLanguage>(locale === "zh" ? "zh" : locale);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms/join/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) {
          setPhase({ kind: "invalid" });
          return;
        }
        if (!response.ok) {
          setPhase({ kind: "form" });
          return;
        }
        const payload = await response.json() as
          | { state: "form" }
          | { state: "session"; id: string; name: string; language: RoomLanguage };
        if (payload.state === "session") {
          setName(payload.name);
          setLanguage(payload.language);
          setPhase({ kind: "session", id: payload.id, name: payload.name, language: payload.language });
        } else {
          setPhase({ kind: "form" });
        }
      })
      .catch(() => { if (!cancelled) setPhase({ kind: "form" }); });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/rooms/join/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password, language }),
      });
      if (response.status === 429) {
        setError(t("시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요."));
        return;
      }
      if (!response.ok) {
        setError(t("링크 또는 비밀번호가 올바르지 않거나 만료되었습니다."));
        return;
      }
      const payload = await response.json() as { id: string };
      setPhase({ kind: "room", id: payload.id });
    } catch {
      setError(t("입장하지 못했습니다. 연결을 확인해 주세요."));
    } finally {
      setSubmitting(false);
    }
  };

  if (phase.kind === "room") {
    return (
      <div className="min-h-dvh bg-bg">
        <div className="flex items-center justify-between border-b border-line bg-chrome px-4 py-3 sm:px-6">
          <BrandWordmark />
        </div>
        <InterpreterRoom roomId={phase.id} role="guest" />
      </div>
    );
  }

  const shellHeader = (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <BrandWordmark />
      <LocaleSwitcher groupLabel={ROOM_LANGUAGE_GROUP_LABEL} className="flex" />
    </div>
  );

  if (phase.kind === "invalid") {
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-12 sm:px-6">
        {shellHeader}
        <p className="text-[12px] font-semibold tracking-[0.12em] text-accent">{t("통역 회의실")}</p>
        <h1 className="mt-2 text-[24px] font-bold tracking-tight">{t("잘못된 접근입니다")}</h1>
        <p role="alert" className="mt-3 text-[14px] leading-6 text-inkSoft">
          {t("이 링크로는 열 수 있는 회의실이 없습니다. 초대한 사람에게 받은 주소를 그대로 다시 열어 주세요. 회의가 끝난 뒤 24시간이 지나면 링크는 자동으로 닫힙니다.")}
        </p>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-12 sm:px-6">
      {shellHeader}
      <p className="text-[12px] font-semibold tracking-[0.12em] text-accent">{t("통역 회의실")}</p>
      <h1 className="mt-2 text-[24px] font-bold tracking-tight">{t("회의실에 입장하기")}</h1>
      {phase.kind === "checking" ? (
        <p className="mt-6 text-[14px] text-inkSoft">{t("확인하는 중…")}</p>
      ) : (
        <>
          {phase.kind === "session" ? (
            <div className="mt-6 grid gap-3 rounded-xl border border-line bg-panel p-4">
              <p className="text-[14px] text-ink">{t("이전에 {name} 이름으로 입장한 기록이 있습니다.", { name: phase.name })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPhase({ kind: "room", id: phase.id })} className="min-h-11 rounded-lg bg-accent px-4 text-[14px] font-semibold text-bg hover:opacity-90">
                  {t("같은 이름으로 계속")}
                </button>
                <button type="button" onClick={() => { setName(""); setPassword(""); setPhase({ kind: "form" }); }} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[14px] font-semibold text-ink hover:bg-soft">
                  {t("다른 이름으로 입장")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-3 text-[14px] leading-6 text-inkSoft">{t("초대한 사람에게 받은 비밀번호와 표시할 이름을 입력해 주세요.")}</p>
              <form onSubmit={submit} className="mt-8 grid gap-5">
                <label className="grid gap-1 text-[13px] font-semibold text-ink">
                  {t("이름")}
                  <input id="guest-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required autoComplete="name" className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] font-normal text-ink" />
                </label>
                <label className="grid gap-1 text-[13px] font-semibold text-ink">
                  {t("비밀번호")}
                  <input id="guest-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={64} required autoComplete="off" className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] font-normal text-ink" />
                </label>
                <label className="grid gap-1 text-[13px] font-semibold text-ink">
                  {t("내 언어")}
                  <select id="guest-language" value={language} onChange={(event) => setLanguage(event.target.value as RoomLanguage)} className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] font-normal text-ink">
                    {ROOM_LANGUAGES.map((code) => <option key={code} value={code}>{ROOM_LANGUAGE_LABELS[code]}</option>)}
                  </select>
                </label>
                {error && <p role="alert" className="text-[13px] text-error">{error}</p>}
                <div>
                  <button type="submit" disabled={submitting || name.trim().length === 0 || password.length === 0} className="min-h-11 rounded-lg bg-accent px-5 text-[14px] font-semibold text-bg hover:opacity-90 disabled:opacity-60">
                    {submitting ? t("입장하는 중…") : t("입장")}
                  </button>
                </div>
              </form>
            </>
          )}
        </>
      )}
    </main>
  );
}
