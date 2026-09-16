"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAppPreferences } from "@/components/AppPreferences";
import { ROOM_INVITE_STORAGE_PREFIX } from "@/components/InterpreterRoom";
import { ROOM_LANGUAGES, type RoomLanguage, type RoomMode } from "@/domain/room";
import { ROOM_LANGUAGE_LABELS } from "@/lib/roomExport";

// Host entry point: pick the mode and my language, get a link + password.
// The plain password is shown only once by the API, so we keep it in session
// storage for the invite button on the room screen.
export function RoomCreateClient() {
  const { t, locale } = useAppPreferences();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<RoomMode>("remote");
  const [language, setLanguage] = useState<RoomLanguage>(locale === "zh" ? "zh" : locale);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(title.trim() ? { title: title.trim() } : {}), mode, hostLanguage: language }),
      });
      if (!response.ok) throw new Error("create_failed");
      const payload = await response.json() as { id: string; invite: { url: string; password: string } };
      try {
        sessionStorage.setItem(`${ROOM_INVITE_STORAGE_PREFIX}${payload.id}`, JSON.stringify({ ...payload.invite, fresh: true }));
      } catch {
        // The room screen still works; the host can rotate to get a new password.
      }
      router.push(`/rooms/${payload.id}`);
    } catch {
      setError(t("회의실을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
      setSubmitting(false);
    }
  };

  return (
    <main id="main" className="max-w-2xl px-4 py-12 sm:px-6">
      <p className="text-[12px] font-semibold tracking-[0.12em] text-accent">{t("통역 회의실")}</p>
      <h1 className="mt-2 text-[24px] font-bold tracking-tight">{t("통역 회의실 만들기")}</h1>
      <p className="mt-3 max-w-lg text-[14px] leading-6 text-inkSoft">
        {t("상대에게 링크와 비밀번호를 보내면 각자 자기 언어로 같은 대화를 봅니다. 음성은 화상회의나 같은 방에서 그대로 주고받습니다.")}
      </p>
      <form onSubmit={submit} className="mt-8 grid gap-5">
        <label className="grid gap-1 text-[13px] font-semibold text-ink">
          {t("회의 제목 (선택)")}
          <input id="room-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] font-normal text-ink" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-[13px] font-semibold text-ink">{t("회의 방식")}</legend>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-panel px-3 text-[14px]">
            <input id="room-mode-remote" type="radio" name="mode" checked={mode === "remote"} onChange={() => setMode("remote")} />
            <span><span className="font-semibold">{t("화상회의")}</span> · {t("각자 자기 기기 마이크로 말합니다.")}</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-panel px-3 text-[14px]">
            <input id="room-mode-same" type="radio" name="mode" checked={mode === "same_room"} onChange={() => setMode("same_room")} />
            <span><span className="font-semibold">{t("같은 방")}</span> · {t("내 기기 마이크 하나로 두 사람의 말을 듣습니다.")}</span>
          </label>
        </fieldset>
        <label className="grid gap-1 text-[13px] font-semibold text-ink">
          {t("내 언어")}
          <select id="room-host-language" value={language} onChange={(event) => setLanguage(event.target.value as RoomLanguage)} className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] font-normal text-ink">
            {ROOM_LANGUAGES.map((code) => <option key={code} value={code}>{ROOM_LANGUAGE_LABELS[code]}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-[13px] text-error">{error}</p>}
        <div>
          <button type="submit" disabled={submitting} className="min-h-11 rounded-lg bg-accent px-5 text-[14px] font-semibold text-bg hover:opacity-90 disabled:opacity-60">
            {submitting ? t("만드는 중…") : t("만들기")}
          </button>
        </div>
      </form>
    </main>
  );
}
