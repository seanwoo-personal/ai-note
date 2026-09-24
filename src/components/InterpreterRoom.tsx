"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppPreferences } from "@/components/AppPreferences";
import { AppDialog } from "@/components/AppDialog";
import { LocaleSwitcher, ROOM_LANGUAGE_GROUP_LABEL } from "@/components/LocaleSwitcher";
import { useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";
import { useSonioxTts } from "@/components/useSonioxTts";
import { buildInviteText, ROOM_LANGUAGES, type RoomEvent, type RoomLanguage, type RoomRole } from "@/domain/room";
import type { PublicRoom } from "@/lib/roomApi";
import { ROOM_LANGUAGE_LABELS } from "@/lib/roomExport";
import { ROOM_VOICES, selectSpeechJobs, type RoomVoice, type SpeechJob } from "@/lib/roomSpeech";
import { applyRoomEvent, emptyRoomView, utterancePerspective, type RoomViewState } from "@/lib/roomView";
import { type CoalescedUtterance, UtteranceCoalescer } from "@/lib/utteranceCoalescer";

// A fragment that does not end a sentence waits this long for its continuation
// (a breath pause) before it is committed on its own.
const UTTERANCE_HOLD_MS = 1_800;
const UTTERANCE_MAX_CHARS = 400;

// Shared interpreter room screen (ADR 0028). The same component serves the host
// and the guest; only `role` and the invite controls differ. Audio never
// travels through this page — Zoom/Meet or the room itself carries the voice.
// Each finished sentence is transcribed and translated live by the capture
// session (two-way between the two seats) and posted to the room; the server
// only falls back to the summary model when no live translation arrived.

export const ROOM_INVITE_STORAGE_PREFIX = "ai-note-room-invite:";

type ConnectionState = "connecting" | "live" | "reconnecting" | "closed";

interface InterpreterRoomProps {
  roomId: string;
  role: RoomRole;
}

interface StoredInvite {
  url: string;
  password: string;
  /** Set right after creation so the room screen opens the invite dialog once. */
  fresh?: boolean;
}

function readStoredInvite(roomId: string): StoredInvite | null {
  try {
    const raw = sessionStorage.getItem(`${ROOM_INVITE_STORAGE_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredInvite>;
    return typeof parsed.url === "string" && typeof parsed.password === "string"
      ? { url: parsed.url, password: parsed.password, fresh: parsed.fresh === true }
      : null;
  } catch {
    return null;
  }
}

function storeInvite(roomId: string, invite: StoredInvite): void {
  try {
    sessionStorage.setItem(`${ROOM_INVITE_STORAGE_PREFIX}${roomId}`, JSON.stringify(invite));
  } catch {
    // Session storage is a convenience only.
  }
}

function languageLabel(code: string): string {
  return (ROOM_LANGUAGE_LABELS as Record<string, string>)[code] ?? code;
}

export function InterpreterRoom({ roomId, role }: InterpreterRoomProps) {
  const { t } = useAppPreferences();
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<RoomViewState>(() => emptyRoomView());
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [invite, setInvite] = useState<StoredInvite | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [rotateOpen, setRotateOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [busy, setBusy] = useState<"rotate" | "end" | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [downloadLanguage, setDownloadLanguage] = useState<RoomLanguage>("ja");
  const [downloadFormat, setDownloadFormat] = useState<"md" | "docx" | "html">("docx");
  const [preview, setPreview] = useState<{ kind: "transcript" | "minutes"; state: "loading" | "ready" | "error"; text: string } | null>(null);
  const [registering, setRegistering] = useState<RoomRole | null>(null);
  const [registerStatus, setRegisterStatus] = useState<string | null>(null);
  const registeringRef = useRef<RoomRole | null>(null);
  const capture = useSonioxLiveCapture();
  // Spoken interpretation: the other seat's words, read aloud in my language.
  const speech = useSonioxTts();
  const [voiceOn, setVoiceOn] = useState(false);
  const [voice, setVoice] = useState<RoomVoice>("Maya");
  const [speechQueue, setSpeechQueue] = useState<SpeechJob[]>([]);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const spokenRef = useRef(new Set<string>());
  const speechProcessingRef = useRef(false);
  const clientIdRef = useRef<string>("");
  const lastEndpointRef = useRef(0);
  const originalLengthsRef = useRef<Record<string, number>>({});
  const translationLengthsRef = useRef<Record<string, number>>({});
  const coalescerRef = useRef(new UtteranceCoalescer({ holdMs: UTTERANCE_HOLD_MS, maxChars: UTTERANCE_MAX_CHARS }));
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = useRef<(item: CoalescedUtterance) => void>(() => undefined);
  const listRef = useRef<HTMLOListElement>(null);
  const inviteCopyRef = useRef<HTMLButtonElement>(null);
  const rotateCancelRef = useRef<HTMLButtonElement>(null);
  const endCancelRef = useRef<HTMLButtonElement>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);

  if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID();

  const me = useMemo(() => {
    const participant = view.participants.find((item) => item.role === role);
    return participant ?? room?.me ?? null;
  }, [role, room?.me, view.participants]);
  const other = view.participants.find((item) => item.role !== role) ?? null;
  const ended = view.endedAt ?? room?.endedAt ?? null;
  const canSpeak = !ended && (room?.mode === "remote" || role === "host");

  const loadRoom = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });
      if (!response.ok) {
        setLoadError(response.status === 404 ? t("이 회의실을 열 수 없습니다.") : t("회의실 정보를 불러오지 못했습니다."));
        return;
      }
      const payload = await response.json() as PublicRoom;
      setRoom(payload);
      setView((current) => ({ ...current, participants: payload.participants, endedAt: payload.endedAt }));
      setDownloadLanguage(payload.me.language);
    } catch {
      setLoadError(t("회의실 정보를 불러오지 못했습니다."));
    }
  }, [roomId, t]);

  useEffect(() => {
    void loadRoom();
    if (role !== "host") return;
    const stored = readStoredInvite(roomId);
    setInvite(stored);
    if (stored?.fresh) {
      setInviteOpen(true);
      storeInvite(roomId, { url: stored.url, password: stored.password });
    }
  }, [loadRoom, role, roomId]);

  useEffect(() => {
    if (!room) return;
    const source = new EventSource(`/api/rooms/${roomId}/events`);
    const handle = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as RoomEvent;
        setView((current) => applyRoomEvent(current, parsed));
      } catch {
        // Ignore malformed frames; the log stays authoritative.
      }
    };
    for (const type of ["utterance", "translation", "attribution", "participant", "ended"]) {
      source.addEventListener(type, handle as EventListener);
    }
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection((current) => (current === "closed" ? current : "reconnecting"));
    return () => {
      source.close();
      setConnection("closed");
    };
  }, [room, roomId]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [view.utterances.length]);

  // One committed utterance = one POST. Breath-broken endpoints are merged by
  // the coalescer first; the live two-way translation of the merged pieces is
  // sent along so the other seat reads something instantly, and the server
  // refines it with context afterwards.
  const submitUtterance = useCallback((item: CoalescedUtterance) => {
    const sourceLanguage = item.language;
    const liveLanguage = !item.codeSwitched && me && other
      ? (sourceLanguage === me.language ? other.language : sourceLanguage === other.language ? me.language : null)
      : null;
    const liveTranslation = liveLanguage && item.translation ? { language: liveLanguage, text: item.translation } : undefined;
    void fetch(`/api/rooms/${roomId}/utterances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        utteranceId: `${clientIdRef.current}-${item.ids[0]}`,
        original: item.original,
        sourceLanguage,
        speakerLabel: item.speakerLabel,
        ...(liveTranslation ? { liveTranslation } : {}),
      }),
    }).catch(() => setCaptureError(t("발화를 전송하지 못했습니다. 연결을 확인해 주세요.")));
  }, [me, other, roomId, t]);

  useEffect(() => {
    submitRef.current = submitUtterance;
  }, [submitUtterance]);

  const armFlush = useCallback(function arm() {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    const deadline = coalescerRef.current.nextDeadline();
    if (deadline === null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      for (const item of coalescerRef.current.flushStale(Date.now())) submitRef.current(item);
      arm();
    }, Math.max(0, deadline - Date.now()));
  }, []);

  const flushPending = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    for (const item of coalescerRef.current.flushAll()) submitRef.current(item);
  }, []);

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
  }, []);

  useEffect(() => {
    if (!ended) return;
    flushPending();
    capture.stop();
  }, [capture, ended, flushPending]);

  useEffect(() => {
    if (capture.transcript.endpointCount <= lastEndpointRef.current) return;
    const endpoints = (capture.transcript.endpoints ?? []).filter((endpoint) => endpoint.id > lastEndpointRef.current);
    lastEndpointRef.current = capture.transcript.endpointCount;
    for (const endpoint of endpoints) {
      const key = endpoint.speaker ?? "unknown";
      const previousLength = originalLengthsRef.current[key] ?? 0;
      const previousTranslationLength = translationLengthsRef.current[key] ?? 0;
      const original = endpoint.originalFinal.slice(previousLength).trim();
      const liveText = endpoint.translationFinal.slice(previousTranslationLength).trim();
      originalLengthsRef.current[key] = endpoint.originalFinal.length;
      translationLengthsRef.current[key] = endpoint.translationFinal.length;
      if (!original) continue;
      const registerRole = registeringRef.current;
      if (registerRole && endpoint.speaker) {
        registeringRef.current = null;
        setRegistering(null);
        void fetch(`/api/rooms/${roomId}/participants/${registerRole}/speaker-label`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ speakerLabel: endpoint.speaker }),
        }).then((response) => {
          setRegisterStatus(response.ok ? t("목소리를 등록했습니다.") : t("목소리를 등록하지 못했습니다. 다시 시도해 주세요."));
        }).catch(() => setRegisterStatus(t("목소리를 등록하지 못했습니다. 다시 시도해 주세요.")));
      }
      const sourceLanguage = endpoint.originalLanguage ?? me?.language ?? "ko";
      // Two-way live translation targets the other participant's language when I
      // spoke mine, and mine when they spoke theirs. A code-switched utterance is
      // left to the server so a partial live translation never reaches the log.
      const liveLanguage = !endpoint.codeSwitched && me && other
        ? (sourceLanguage === me.language ? other.language : sourceLanguage === other.language ? me.language : null)
        : null;
      const commits = coalescerRef.current.push({
        id: endpoint.id,
        key,
        speakerLabel: endpoint.speaker ?? null,
        language: sourceLanguage,
        original,
        translation: liveLanguage ? liveText : "",
        translationLanguage: liveLanguage,
        codeSwitched: Boolean(endpoint.codeSwitched),
        at: Date.now(),
      });
      for (const item of commits) submitUtterance(item);
    }
    armFlush();
  }, [armFlush, capture.transcript.endpointCount, capture.transcript.endpoints, me, other, roomId, submitUtterance, t]);

  useEffect(() => {
    if (!voiceOn || !me) return;
    const jobs = selectSpeechJobs(view.utterances, me, spokenRef.current);
    if (jobs.length === 0) return;
    for (const job of jobs) spokenRef.current.add(job.utteranceId);
    setSpeechQueue((current) => [...current, ...jobs]);
  }, [me, view.utterances, voiceOn]);

  // Depend on the stable callbacks, not the hook's per-render result object.
  const speak = speech.speak;
  const prepareSpeech = speech.prepare;
  const stopSpeech = speech.stop;
  useEffect(() => {
    if (!voiceOn || speechProcessingRef.current || speechQueue.length === 0) return;
    if (!["idle", "finished", "error"].includes(speech.phase)) return;
    const job = speechQueue[0];
    speechProcessingRef.current = true;
    void speak({ text: job.text, language: job.language, voice }).catch(() => {
      setSpeechError(t("통역 음성을 재생하지 못했습니다."));
    }).finally(() => {
      speechProcessingRef.current = false;
      setSpeechQueue((current) => current.filter((item) => item.utteranceId !== job.utteranceId));
    });
  }, [speak, speech.phase, speechQueue, t, voice, voiceOn]);

  const toggleVoice = useCallback(() => {
    if (voiceOn) {
      setVoiceOn(false);
      setSpeechQueue([]);
      stopSpeech();
      return;
    }
    // Start from now: history is not read back, and playback is unlocked inside the click.
    for (const utterance of view.utterances) spokenRef.current.add(utterance.utteranceId);
    setSpeechError(null);
    setVoiceOn(true);
    void prepareSpeech().catch(() => setSpeechError(t("통역 음성을 재생하지 못했습니다.")));
  }, [prepareSpeech, stopSpeech, t, view.utterances, voiceOn]);

  useEffect(() => {
    if (!ended) return;
    setVoiceOn(false);
    setSpeechQueue([]);
    stopSpeech();
  }, [ended, stopSpeech]);

  const translationPair = me && other && me.language !== other.language ? `${me.language}|${other.language}` : "";
  const startCapture = useCallback(() => {
    lastEndpointRef.current = 0;
    originalLengthsRef.current = {};
    translationLengthsRef.current = {};
    capture.reset();
    const [languageA, languageB] = translationPair.split("|");
    void capture.start({
      inputSource: "microphone",
      // Soniox translates each finished sentence live between the two seats.
      translation: translationPair ? { mode: "two_way", languageA, languageB } : { mode: "none" },
    }).catch(() => {
      setCaptureError(t("마이크를 시작하지 못했습니다. 권한을 확인해 주세요."));
    });
  }, [capture, t, translationPair]);

  const toggleSpeaking = useCallback(() => {
    setCaptureError(null);
    if (capture.phase === "listening" || capture.phase === "connecting" || capture.phase === "requesting") {
      flushPending();
      capture.stop();
      return;
    }
    startCapture();
  }, [capture, flushPending, startCapture]);

  // When the other seat (or its language) changes while I'm listening, restart
  // the session so live translation follows the new pair.
  const activePairRef = useRef(translationPair);
  useEffect(() => {
    if (activePairRef.current === translationPair) return;
    activePairRef.current = translationPair;
    if (capture.phase !== "listening") return;
    capture.stop();
    const timer = setTimeout(() => startCapture(), 300);
    return () => clearTimeout(timer);
  }, [capture, startCapture, translationPair]);

  const copyInvite = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(buildInviteText({ url: invite.url, password: invite.password }));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }, [invite]);

  const rotateInvite = useCallback(async () => {
    setBusy("rotate");
    try {
      const response = await fetch(`/api/rooms/${roomId}/invite/rotate`, { method: "POST" });
      if (!response.ok) throw new Error("rotate_failed");
      const payload = await response.json() as { invite: StoredInvite };
      storeInvite(roomId, payload.invite);
      setInvite(payload.invite);
      setInviteStatus(t("새 비밀번호를 만들었습니다. 기존 게스트는 다시 입장해야 합니다."));
      setRotateOpen(false);
      setCopyState("idle");
      setInviteOpen(true);
    } catch {
      setInviteStatus(t("새 비밀번호를 만들지 못했습니다."));
    } finally {
      setBusy(null);
    }
  }, [roomId, t]);

  const endRoom = useCallback(async () => {
    setBusy("end");
    try {
      capture.stop();
      const response = await fetch(`/api/rooms/${roomId}/end`, { method: "POST" });
      if (!response.ok) throw new Error("end_failed");
      const payload = await response.json() as { endedAt: string };
      setView((current) => ({ ...current, endedAt: payload.endedAt }));
      setEndOpen(false);
    } catch {
      setInviteStatus(t("회의를 종료하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setBusy(null);
    }
  }, [capture, roomId, t]);

  const correctSpeaker = useCallback(async (utteranceId: string, speaker: RoomRole) => {
    try {
      await fetch(`/api/rooms/${roomId}/utterances/${encodeURIComponent(utteranceId)}/speaker`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speaker }),
      });
    } catch {
      setCaptureError(t("화자를 바꾸지 못했습니다."));
    }
  }, [roomId, t]);

  const beginRegistration = useCallback((target: RoomRole) => {
    setRegisterStatus(null);
    registeringRef.current = target;
    setRegistering(target);
    if (capture.phase !== "listening" && capture.phase !== "connecting" && capture.phase !== "requesting") startCapture();
  }, [capture.phase, startCapture]);

  const exportHref = useCallback((kind: "transcript" | "minutes", format: "md" | "docx" | "html", language: RoomLanguage) =>
    `/api/rooms/${roomId}/export?kind=${kind}&language=${language}&format=${format}`, [roomId]);

  const openPreview = useCallback(async (kind: "transcript" | "minutes") => {
    setPreview({ kind, state: "loading", text: "" });
    try {
      const language = kind === "minutes" ? downloadLanguage : (me?.language ?? downloadLanguage);
      const response = await fetch(exportHref(kind, "md", language), { cache: "no-store" });
      if (!response.ok) throw new Error("preview_failed");
      setPreview({ kind, state: "ready", text: await response.text() });
    } catch {
      setPreview({ kind, state: "error", text: "" });
    }
  }, [downloadLanguage, exportHref, me?.language]);

  if (loadError) {
    return (
      <main id="main" className="max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-[24px] font-bold tracking-tight">{t("통역 회의실")}</h1>
        <p role="alert" className="mt-4 rounded-lg border border-line bg-panel px-4 py-3 text-[14px] text-inkSoft">{loadError}</p>
      </main>
    );
  }
  if (!room || !me) {
    return <main id="main" className="px-4 py-12 text-[14px] text-inkSoft sm:px-6">{t("회의실을 불러오는 중…")}</main>;
  }

  const speaking = capture.phase === "listening";
  const connectionLabel = connection === "live" ? t("실시간 연결됨") : connection === "reconnecting" ? t("다시 연결하는 중…") : connection === "closed" ? t("연결 종료") : t("연결 중…");

  return (
    <main id="main" className="flex min-h-[calc(100dvh-4rem)] max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:min-h-dvh">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-accent">{t("통역 회의실")}</p>
            <h1 className="text-[24px] font-bold tracking-tight">{room.title ?? t("제목 없는 회의")}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {role === "guest" && <LocaleSwitcher groupLabel={ROOM_LANGUAGE_GROUP_LABEL} className="flex" />}
            {role === "host" && !ended && (
              <>
                <button type="button" onClick={() => { setCopyState("idle"); setInviteOpen(true); }} disabled={!invite} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[14px] font-semibold text-ink hover:bg-soft disabled:opacity-50">
                  {t("초대하기")}
                </button>
                <button type="button" onClick={() => setRotateOpen(true)} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[14px] font-semibold text-ink hover:bg-soft">
                  {t("새 비밀번호")}
                </button>
                <button type="button" onClick={() => setEndOpen(true)} className="min-h-11 rounded-lg bg-accent px-4 text-[14px] font-semibold text-bg hover:opacity-90">
                  {t("회의 종료")}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-inkSoft">
          <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-semibold">{room.mode === "remote" ? t("화상회의") : t("같은 방")}</span>
          <span className="rounded-full border border-line bg-panel px-2.5 py-1">{connectionLabel}</span>
          {ended && <span className="rounded-full bg-warnBg px-2.5 py-1 font-semibold text-warn">{t("회의가 끝났습니다")}</span>}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("참가자")}>
          {[me, other].map((participant, index) => (
            <li key={index} className="rounded-lg border border-line bg-panel px-4 py-3">
              {participant ? (
                <>
                  <p className="text-[14px] font-semibold text-ink">{participant.name} {participant.role === role && <span className="text-inkSoft">· {t("나")}</span>}</p>
                  <p className="text-[12px] text-inkSoft">{languageLabel(participant.language)}</p>
                </>
              ) : (
                <p className="text-[13px] text-inkSoft">{t("상대가 아직 입장하지 않았습니다.")}</p>
              )}
            </li>
          ))}
        </ul>
        {inviteStatus && <p role="status" aria-live="polite" className="text-[13px] text-inkSoft">{inviteStatus}</p>}
      </header>

      {room.mode === "same_room" && role === "host" && !ended && (
        <section className="grid gap-2 rounded-xl border border-line bg-panel p-4" aria-label={t("목소리 등록")}>
          <p className="text-[13px] font-semibold text-ink">{t("목소리 등록")}</p>
          <p className="text-[13px] text-inkSoft">{t("같은 방에서는 각자 한 문장을 말해 목소리를 등록하면 두 사람이 같은 언어로 말해도 화자를 구분합니다.")}</p>
          <div className="flex flex-wrap gap-2">
            {[me, other].filter((participant): participant is NonNullable<typeof participant> => participant !== null).map((participant) => (
              <button
                key={participant.role}
                type="button"
                onClick={() => beginRegistration(participant.role)}
                disabled={registering !== null}
                aria-pressed={registering === participant.role}
                className={`min-h-11 rounded-lg border px-4 text-[13px] font-semibold ${participant.registered ? "border-line bg-soft text-inkSoft" : "border-line bg-panel text-ink hover:bg-soft"} disabled:opacity-60`}
              >
                {registering === participant.role
                  ? t("{name} 님이 한 문장을 말해 주세요…", { name: participant.name })
                  : participant.registered
                    ? t("{name} 등록됨 · 다시 등록", { name: participant.name })
                    : t("{name} 목소리 등록", { name: participant.name })}
              </button>
            ))}
          </div>
          {registerStatus && <p role="status" aria-live="polite" className="text-[12px] text-inkSoft">{registerStatus}</p>}
        </section>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label={t("대화")}>
        <ol ref={listRef} className="flex max-h-[60dvh] flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-4">
          {view.utterances.length === 0 && (
            <li className="text-[14px] text-inkSoft">{t("아직 발화가 없습니다. 말하기를 시작하면 여기에 실시간으로 표시됩니다.")}</li>
          )}
          {view.utterances.map((utterance) => {
            const perspective = utterancePerspective(utterance, me, view.participants);
            const lowConfidence = utterance.confidence === "low" && !utterance.corrected;
            return (
              <li key={utterance.utteranceId} className={`grid gap-1 rounded-lg px-3 py-2 ${perspective.mine ? "bg-soft" : "bg-bg"}`}>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${lowConfidence ? "border border-dashed border-warn text-warn" : "bg-chrome text-inkSoft"}`}>
                    {perspective.speakerName}
                  </span>
                  <span className="text-inkSoft">{languageLabel(perspective.primaryLanguage)}</span>
                  {room.mode === "same_room" && !ended && (
                    <button
                      type="button"
                      onClick={() => correctSpeaker(utterance.utteranceId, utterance.speaker === "host" ? "guest" : "host")}
                      className="ml-auto min-h-8 rounded-md border border-line px-2 text-[12px] text-inkSoft hover:bg-soft"
                    >
                      {utterance.speaker === role ? t("상대 말로 바꾸기") : t("내 말로 바꾸기")}
                    </button>
                  )}
                </div>
                <p lang={perspective.primaryLanguage} className="text-[15px] leading-7 text-ink">{perspective.primary}</p>
                {perspective.mine ? (
                  perspective.secondaryLanguage && (
                    <p className="text-[13px] leading-6 text-inkSoft">
                      <span className="font-semibold">{t("상대에게 이렇게 전달됨")} · </span>
                      {perspective.secondaryPending ? t("번역 중…") : <span lang={perspective.secondaryLanguage}>{perspective.secondary}</span>}
                    </p>
                  )
                ) : (
                  perspective.secondary && (
                    <details className="text-[13px] text-inkSoft">
                      <summary className="cursor-pointer">{t("원문 보기")}</summary>
                      <p lang={perspective.secondaryLanguage ?? undefined} className="mt-1 leading-6">{perspective.secondary}</p>
                    </details>
                  )
                )}
                {!perspective.mine && perspective.secondaryPending && (
                  <p className="text-[12px] text-inkSoft">{t("번역 중…")}</p>
                )}
              </li>
            );
          })}
        </ol>

        {ended ? (
          <div className="grid gap-4 rounded-xl border border-line bg-panel p-4">
            <p className="text-[14px] text-ink">{t("회의가 끝났습니다. 24시간 안에 기록을 내려받을 수 있습니다.")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-[12px] text-inkSoft">
                {t("회의록 언어")}
                <select value={downloadLanguage} onChange={(event) => setDownloadLanguage(event.target.value as RoomLanguage)} className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] text-ink">
                  {ROOM_LANGUAGES.map((language) => <option key={language} value={language}>{languageLabel(language)}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[12px] text-inkSoft">
                {t("파일 형식")}
                <select value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value as "md" | "docx" | "html")} className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[14px] text-ink">
                  <option value="docx">Word (.docx)</option>
                  <option value="html">PDF ({t("인쇄 화면")})</option>
                  <option value="md">Markdown (.md)</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openPreview("minutes")} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[14px] font-semibold text-ink hover:bg-soft">
                {t("회의록 미리보기")}
              </button>
              <a
                href={exportHref("minutes", downloadFormat, downloadLanguage)}
                target={downloadFormat === "html" ? "_blank" : undefined}
                rel={downloadFormat === "html" ? "noopener" : undefined}
                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-[14px] font-semibold text-bg hover:opacity-90"
              >
                {t("회의록 내려받기")}
              </a>
              <button type="button" onClick={() => openPreview("transcript")} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[14px] font-semibold text-ink hover:bg-soft">
                {t("대화록 미리보기")}
              </button>
              <a
                href={exportHref("transcript", downloadFormat, me.language)}
                target={downloadFormat === "html" ? "_blank" : undefined}
                rel={downloadFormat === "html" ? "noopener" : undefined}
                className="inline-flex min-h-11 items-center rounded-lg border border-line bg-panel px-4 text-[14px] font-semibold text-ink hover:bg-soft"
              >
                {t("대화록 내려받기")}
              </a>
            </div>
            <p className="text-[12px] text-inkSoft">{t("PDF는 인쇄 화면이 새 탭에 열리며 브라우저의 'PDF로 저장'으로 내려받습니다.")}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {canSpeak ? (
              <button
                type="button"
                onClick={toggleSpeaking}
                aria-pressed={speaking}
                className={`min-h-12 rounded-lg px-5 text-[15px] font-semibold ${speaking ? "bg-error text-bg" : "bg-accent text-bg"} hover:opacity-90`}
              >
                {speaking ? t("말하기 중지") : t("말하기 시작")}
              </button>
            ) : (
              <p className="text-[13px] text-inkSoft">{t("같은 방 모드에서는 호스트 기기가 마이크를 담당합니다.")}</p>
            )}
            <p role="status" aria-live="polite" className="text-[13px] text-inkSoft">
              {captureError ?? capture.error ?? (speaking ? t("듣는 중 · 말이 끝나면 자동으로 기록됩니다.") : "")}
            </p>
            <div className="flex w-full flex-wrap items-center gap-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={toggleVoice}
                aria-pressed={voiceOn}
                className={`min-h-11 rounded-lg border px-4 text-[14px] font-semibold ${voiceOn ? "border-accent bg-soft text-accent" : "border-line bg-panel text-ink"} hover:bg-soft`}
              >
                {voiceOn ? t("통역 음성 끄기") : t("통역 음성 듣기")}
              </button>
              <label className="flex items-center gap-2 text-[13px] text-inkSoft">
                <span>{t("통역 음성")}</span>
                <select
                  value={voice}
                  onChange={(event) => setVoice(event.target.value as RoomVoice)}
                  className="min-h-11 rounded-lg border border-line bg-bg px-3 text-[14px] text-ink"
                >
                  {ROOM_VOICES.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <p role="status" aria-live="polite" className="text-[12px] text-inkSoft">
                {speechError ?? (voiceOn ? (speech.phase === "playing" ? t("재생 중…") : t("이어폰을 끼면 상대 말이 끝난 뒤 내 언어로 들립니다.")) : "")}
              </p>
            </div>
          </div>
        )}
      </section>

      <AppDialog open={inviteOpen} title={t("상대를 초대하기")} onDismiss={() => setInviteOpen(false)} initialFocusRef={inviteCopyRef}>
        <p className="text-[14px] text-inkSoft">{t("아래 주소와 비밀번호를 상대에게 보내 주세요. 링크만으로는 들어올 수 없습니다.")}</p>
        {invite && (
          <dl className="mt-4 grid gap-3 text-[14px]">
            <div className="grid gap-1">
              <dt className="text-[12px] font-semibold text-inkSoft">{t("주소")}</dt>
              <dd className="break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink">{invite.url}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-[12px] font-semibold text-inkSoft">{t("비밀번호")}</dt>
              <dd className="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[16px] tracking-[0.12em] text-ink">{invite.password}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-[12px] font-semibold text-inkSoft">{t("유효 기간")}</dt>
              <dd className="text-inkSoft">{t("회의가 끝난 뒤 24시간 동안 열립니다.")}</dd>
            </div>
          </dl>
        )}
        <p role="status" aria-live="polite" className="mt-3 min-h-5 text-[13px] text-inkSoft">
          {copyState === "copied" ? t("초대 내용을 복사했습니다.") : copyState === "failed" ? t("복사하지 못했습니다. 아래 내용을 직접 복사해 주세요.") : ""}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setInviteOpen(false)} className="min-h-11 rounded-lg border border-line px-4 text-[14px] font-semibold">{t("닫기")}</button>
          <button ref={inviteCopyRef} type="button" onClick={copyInvite} className="min-h-11 rounded-lg bg-accent px-4 text-[14px] font-semibold text-bg">{t("복사하기")}</button>
        </div>
      </AppDialog>

      <AppDialog
        open={preview !== null}
        title={preview?.kind === "transcript" ? t("대화록 미리보기") : t("회의록 미리보기")}
        onDismiss={() => setPreview(null)}
        initialFocusRef={previewCloseRef}
        panelClassName="p-6 max-h-[85dvh] overflow-y-auto"
      >
        {preview?.state === "loading" && <p className="text-[14px] text-inkSoft">{t("불러오는 중…")}</p>}
        {preview?.state === "error" && <p role="alert" className="text-[14px] text-error">{t("미리보기를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.")}</p>}
        {preview?.state === "ready" && (
          <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-ink">{preview.text}</pre>
        )}
        <div className="mt-4 flex justify-end">
          <button ref={previewCloseRef} type="button" onClick={() => setPreview(null)} className="min-h-11 rounded-lg border border-line px-4 text-[14px] font-semibold">{t("닫기")}</button>
        </div>
      </AppDialog>

      <AppDialog open={rotateOpen} title={t("새 비밀번호를 만들까요?")} onDismiss={() => busy !== "rotate" && setRotateOpen(false)} initialFocusRef={rotateCancelRef} dismissible={busy !== "rotate"}>
        <p className="text-[14px] text-inkSoft">{t("기존 링크와 비밀번호는 더 이상 쓸 수 없고, 이미 들어온 게스트는 다시 입장해야 합니다.")}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={rotateCancelRef} type="button" onClick={() => setRotateOpen(false)} disabled={busy === "rotate"} className="min-h-11 rounded-lg border border-line px-4 text-[14px] font-semibold">{t("취소")}</button>
          <button type="button" onClick={rotateInvite} disabled={busy === "rotate"} className="min-h-11 rounded-lg bg-accent px-4 text-[14px] font-semibold text-bg">{busy === "rotate" ? t("만드는 중…") : t("새 비밀번호 만들기")}</button>
        </div>
      </AppDialog>

      <AppDialog open={endOpen} title={t("회의를 종료할까요?")} onDismiss={() => busy !== "end" && setEndOpen(false)} initialFocusRef={endCancelRef} dismissible={busy !== "end"}>
        <p className="text-[14px] text-inkSoft">{t("대화록과 회의록이 저장되고 게스트 링크는 24시간 뒤 만료됩니다.")}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={endCancelRef} type="button" onClick={() => setEndOpen(false)} disabled={busy === "end"} className="min-h-11 rounded-lg border border-line px-4 text-[14px] font-semibold">{t("취소")}</button>
          <button type="button" onClick={endRoom} disabled={busy === "end"} className="min-h-11 rounded-lg bg-accent px-4 text-[14px] font-semibold text-bg">{busy === "end" ? t("종료하는 중…") : t("회의 종료")}</button>
        </div>
      </AppDialog>
    </main>
  );
}
