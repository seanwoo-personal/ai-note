"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";
import { type useSonioxTts } from "@/components/useSonioxTts";
import { useOptionalAppPreferences } from "@/components/AppPreferences";
import { translateUi, type UiValues } from "@/lib/i18n";

const LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
] as const;
const VOICES = ["Maya", "Daniel", "Mina", "Kenji"] as const;

type Capture = ReturnType<typeof useSonioxLiveCapture>;
type Speech = ReturnType<typeof useSonioxTts>;
type Team = "ours" | "theirs";
type Profile = { id: string; team: Team; ordinal: number; name: string };
type SpeechItem = { text: string; language: string; voice: string; speed: number };

function clampCount(value: string, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(maximum, parsed));
}

function hasUtteranceAwaitingEndpoint(transcript: Capture["transcript"]): boolean {
  const tracks = Object.values(transcript.speakers ?? {});
  if (tracks.some((track) => (
    track.original.provisional.trim().length > 0
    || track.translation.provisional.trim().length > 0
  ))) return true;

  const activeSpeaker = transcript.activeSpeaker;
  if (!activeSpeaker) {
    return transcript.original.provisional.trim().length > 0
      || transcript.translation.provisional.trim().length > 0;
  }

  const activeTrack = transcript.speakers?.[activeSpeaker];
  if (!activeTrack) return false;
  const latestEndpoint = [...(transcript.endpoints ?? [])]
    .reverse()
    .find((endpoint) => endpoint.speaker === activeSpeaker);

  if (!latestEndpoint) {
    return activeTrack.original.final.trim().length > 0
      || activeTrack.translation.final.trim().length > 0;
  }

  return activeTrack.original.final !== latestEndpoint.originalFinal
    || activeTrack.translation.final !== latestEndpoint.translationFinal;
}

export function SpeakerTranslatorPanel({ capture, speech }: { capture: Capture; speech: Speech }) {
  const preferences = useOptionalAppPreferences();
  const locale = preferences?.locale ?? "ko";
  const t = useCallback((source: string, values: UiValues = {}) => translateUi(locale, source, values), [locale]);
  const [ourCount, setOurCount] = useState(1);
  const [theirCount, setTheirCount] = useState(1);
  const [names, setNames] = useState<Record<string, string>>(() => ({ ours_1: t("나"), theirs_1: t("상대방") }));
  const [ourLanguage, setOurLanguage] = useState("ko");
  const [theirLanguage, setTheirLanguage] = useState("en");
  const [voice, setVoice] = useState<(typeof VOICES)[number]>("Maya");
  const [speed, setSpeed] = useState(1);
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ profileId: string; speaker: string } | null>(null);
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(null);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [speechQueue, setSpeechQueue] = useState<SpeechItem[]>([]);
  const endpointAtRegistrationRef = useRef(0);
  const lastMeetingEndpointRef = useRef(0);
  const spokenTranslationLengthsRef = useRef<Record<string, number>>({});

  const profiles = useMemo<Profile[]>(() => {
    const next: Profile[] = [];
    for (let index = 1; index <= ourCount; index += 1) {
      const id = `ours_${index}`;
      next.push({ id, team: "ours", ordinal: index, name: names[id] || (index === 1 ? t("나") : t("우리 팀 {number}", { number: index })) });
    }
    for (let index = 1; index <= theirCount; index += 1) {
      const id = `theirs_${index}`;
      next.push({ id, team: "theirs", ordinal: index, name: names[id] || (index === 1 ? t("상대방") : t("상대 팀 {number}", { number: index })) });
    }
    return next;
  }, [names, ourCount, t, theirCount]);

  const listening = capture.phase === "listening";
  const pending = capture.phase === "requesting" || capture.phase === "connecting";
  const registeredCount = profiles.filter((profile) => speakerMap[profile.id]).length;
  const allRegistered = registeredCount === profiles.length;
  const languagesDistinct = ourLanguage !== theirLanguage;

  useEffect(() => {
    if (!pendingProfile || capture.transcript.endpointCount <= endpointAtRegistrationRef.current) return;
    const endpoint = capture.transcript.endpoints?.find((item) => item.id > endpointAtRegistrationRef.current);
    const label = endpoint?.speaker ?? capture.transcript.lastEndpointSpeaker;
    endpointAtRegistrationRef.current = endpoint?.id ?? capture.transcript.endpointCount;
    if (!label) {
      setRegistrationMessage(t("화자를 구분하지 못했습니다. 이름을 다시 누르고 한 문장 더 말해 주세요."));
      setPendingProfile(null);
      return;
    }
    const duplicate = Object.entries(speakerMap).find(([profileId, speaker]) => speaker === label && profileId !== pendingProfile);
    if (duplicate) {
      setRegistrationMessage(t("이미 다른 프로필에 연결된 목소리입니다. 해당 화자가 다시 말해 주세요."));
      setPendingProfile(null);
      return;
    }
    setCandidate({ profileId: pendingProfile, speaker: label });
    setRegistrationMessage(t("감지된 Soniox 화자 번호를 확인한 뒤 연결해 주세요."));
    setPendingProfile(null);
  }, [capture.transcript.endpointCount, capture.transcript.endpoints, capture.transcript.lastEndpointSpeaker, pendingProfile, speakerMap, t]);

  useEffect(() => {
    if (!meetingStarted || capture.transcript.endpointCount <= lastMeetingEndpointRef.current) return;
    const recordedEndpoints = (capture.transcript.endpoints ?? []).filter((item) => item.id > lastMeetingEndpointRef.current);
    const endpoints = recordedEndpoints.length > 0
      ? recordedEndpoints
      : [{
          id: capture.transcript.endpointCount,
          speaker: capture.transcript.lastEndpointSpeaker,
          originalFinal: capture.transcript.lastEndpointSpeaker
            ? capture.transcript.speakers?.[capture.transcript.lastEndpointSpeaker]?.original.final ?? ""
            : "",
          translationFinal: capture.transcript.lastEndpointSpeaker
            ? capture.transcript.speakers?.[capture.transcript.lastEndpointSpeaker]?.translation.final ?? ""
            : "",
        }];
    lastMeetingEndpointRef.current = capture.transcript.endpointCount;
    const queued: SpeechItem[] = [];
    for (const endpoint of endpoints) {
      const speaker = endpoint.speaker;
      if (!speaker) continue;
      const profile = profiles.find((profileCandidate) => speakerMap[profileCandidate.id] === speaker);
      if (!profile || profile.team !== "ours") continue;
      const previousLength = spokenTranslationLengthsRef.current[speaker] ?? 0;
      const nextSentence = endpoint.translationFinal.slice(previousLength).trim();
      spokenTranslationLengthsRef.current[speaker] = endpoint.translationFinal.length;
      if (nextSentence) queued.push({ text: nextSentence, language: theirLanguage, voice, speed });
    }
    if (queued.length) setSpeechQueue((current) => [...current, ...queued]);
  }, [capture.transcript, meetingStarted, profiles, speakerMap, speed, theirLanguage, voice]);

  useEffect(() => {
    if (!meetingStarted || speechQueue.length === 0 || !["idle", "finished", "error"].includes(speech.phase)) return;
    const [next, ...remaining] = speechQueue;
    setSpeechQueue(remaining);
    void speech.speak(next);
  }, [meetingStarted, speech, speech.phase, speechQueue]);

  const confirmCandidate = () => {
    if (!candidate) return;
    setSpeakerMap((current) => ({ ...current, [candidate.profileId]: candidate.speaker }));
    setCandidate(null);
    setRegistrationMessage(t("현재 세션의 화자 번호와 프로필을 연결했습니다."));
  };

  const beginRegistration = () => {
    if (!languagesDistinct) {
      setRegistrationMessage(t("우리 팀과 상대 팀 언어를 다르게 선택해 주세요."));
      return;
    }
    setSpeakerMap({});
    setPendingProfile(null);
    setCandidate(null);
    setMeetingStarted(false);
    setSpeechQueue([]);
    setRegistrationMessage(null);
    capture.reset();
    speech.stop();
    const participantDescription = profiles
      .map((profile) => `${profile.name} (${profile.team === "ours" ? "our team" : "other team"})`)
      .join(", ");
    void capture.start({
      inputSource: "microphone",
      translation: { mode: "two_way", languageA: ourLanguage, languageB: theirLanguage },
      context: {
        general: [{ key: "speakers", value: `${profiles.length} speakers: ${participantDescription}` }],
        terms: profiles.map((profile) => profile.name).filter(Boolean),
      },
    });
  };

  const beginMeeting = () => {
    if (!allRegistered || candidate) return;
    lastMeetingEndpointRef.current = capture.transcript.endpointCount;
    spokenTranslationLengthsRef.current = Object.fromEntries(
      Object.entries(capture.transcript.speakers ?? {}).map(([speaker, track]) => [speaker, track.translation.final.length]),
    );
    setMeetingStarted(true);
    setRegistrationMessage(t("실시간 통역을 시작했습니다. 우리 팀 발화의 번역만 문장 종료 후 음성으로 재생합니다."));
    void speech.prepare();
  };

  const stopSession = () => {
    capture.stop();
    speech.stop();
    setPendingProfile(null);
    setCandidate(null);
    setMeetingStarted(false);
    setSpeechQueue([]);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold text-ink">화자 프로필과 통역 방향</h2>
            <p className="mt-2 text-[13px] leading-6 text-inkSoft">
              이 등록은 영구 음성 생체 등록이 아니라 현재 세션의 화자 번호와 프로필을 연결하는 절차입니다. 세션마다 다시 확인해야 합니다.
            </p>
          </div>
          <span role="status" className="rounded-full bg-soft px-3 py-2 text-[12px] font-bold text-inkSoft">
            {meetingStarted ? t("통역 중") : listening ? t("등록 {count}/{total}", { count: registeredCount, total: profiles.length }) : pending ? t("연결 중") : t("설정 중")}
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="우리 팀 인원" value={ourCount} maximum={Math.max(1, 15 - theirCount)} disabled={listening || pending} onChange={setOurCount} />
          <NumberField label="상대 팀 인원" value={theirCount} maximum={Math.max(1, 15 - ourCount)} disabled={listening || pending} onChange={setTheirCount} />
          <LanguageField label="우리 팀 언어" value={ourLanguage} disabled={listening || pending} onChange={setOurLanguage} />
          <LanguageField label="상대 팀 언어" value={theirLanguage} disabled={listening || pending} onChange={setTheirLanguage} />
        </div>
        {!languagesDistinct && (
          <p role="alert" className="mt-3 text-[13px] font-semibold text-error">
            {t("우리 팀과 상대 팀 언어를 다르게 선택해 주세요.")}
          </p>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {profiles.map((profile) => {
            const label = t("{team} {number}", { team: t(profile.team === "ours" ? "우리 팀" : "상대 팀"), number: profile.ordinal });
            const mappedSpeaker = speakerMap[profile.id];
            return (
              <article key={profile.id} className="rounded-xl border border-line bg-soft/40 p-4">
                <label className="block text-[12px] font-bold text-inkSoft">
                  {t("{label} 이름", { label })}
                  <input
                    aria-label={t("{label} 이름", { label })}
                    value={profile.name}
                    disabled={listening || pending}
                    onChange={(event) => setNames((current) => ({ ...current, [profile.id]: event.target.value }))}
                    className="mt-2 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-[14px] text-ink"
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-inkSoft">
                    {mappedSpeaker
                      ? t("등록됨 · Soniox 화자 {speaker}", { speaker: mappedSpeaker })
                      : pendingProfile === profile.id
                        ? t("한 문장을 말해 주세요…")
                        : candidate?.profileId === profile.id
                          ? t("감지된 화자 확인 대기")
                          : t("미등록")}
                  </span>
                  {listening && !meetingStarted && (
                    <button
                      type="button"
                      aria-label="목소리 등록"
                      disabled={Boolean(pendingProfile || candidate)}
                      onClick={() => {
                        if (hasUtteranceAwaitingEndpoint(capture.transcript)) {
                          setRegistrationMessage(t("현재 문장이 끝난 뒤 다시 등록해 주세요."));
                          return;
                        }
                        endpointAtRegistrationRef.current = capture.transcript.endpointCount;
                        setPendingProfile(profile.id);
                        setRegistrationMessage(t("{name} 님이 자연스러운 한 문장을 말해 주세요.", { name: profile.name }));
                      }}
                      className="min-h-11 rounded-lg border border-line bg-panel px-3 text-[12px] font-bold text-accent disabled:opacity-40"
                    >
                      목소리 등록
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {candidate && (
          <div className="mt-4 rounded-xl border border-accent/40 bg-soft p-4" role="group" aria-label="감지된 화자 확인">
            <p className="text-[13px] font-semibold text-ink">
              {t("{name} 님을 Soniox 화자 {speaker}로 연결할까요?", {
                name: profiles.find((profile) => profile.id === candidate.profileId)?.name ?? "",
                speaker: candidate.speaker,
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={confirmCandidate} className="min-h-11 rounded-lg bg-accent px-4 text-[13px] font-bold text-white">이 화자로 확인</button>
              <button type="button" onClick={() => { setCandidate(null); setRegistrationMessage(t("같은 참가자가 한 문장을 다시 말해 주세요.")); }} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[13px] font-bold text-accent">다시 말하기</button>
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <LanguageField label="우리 팀 번역 음성" value={voice} disabled={meetingStarted} onChange={(value) => setVoice(value as (typeof VOICES)[number])} options={VOICES.map((value) => ({ value, label: value }))} />
          <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
            음성 속도
            <select aria-label="화자 통역 음성 속도" value={speed} disabled={meetingStarted} onChange={(event) => setSpeed(Number(event.target.value))} className="min-h-11 rounded-xl border border-line bg-bg px-3">
              <option value={0.8}>느리게 (0.8×)</option><option value={1}>보통 (1.0×)</option><option value={1.2}>빠르게 (1.2×)</option>
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {!listening && !pending ? (
            <button type="button" disabled={!languagesDistinct} onClick={beginRegistration} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-bold text-bg disabled:opacity-40">화자 등록 시작</button>
          ) : !meetingStarted ? (
            <>
              <button type="button" disabled={!allRegistered || Boolean(pendingProfile || candidate)} onClick={beginMeeting} className="min-h-11 rounded-full bg-accent px-5 text-[14px] font-bold text-white disabled:opacity-40">실시간 통역 시작</button>
              <button type="button" onClick={stopSession} className="min-h-11 rounded-full border border-line px-5 text-[14px] font-bold text-accent">등록 취소</button>
            </>
          ) : (
            <button type="button" onClick={stopSession} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-bold text-bg">실시간 통역 중지</button>
          )}
        </div>
        {registrationMessage && <p role="status" className="mt-4 text-[13px] font-medium text-ink">{registrationMessage}</p>}
        {capture.error && <p role="alert" className="mt-4 text-[13px] text-error">{capture.error}</p>}
        {speech.error && <p role="alert" className="mt-4 text-[13px] text-error">{speech.error}</p>}
        <p className="mt-4 text-[12px] leading-5 text-inkSoft">Soniox 실시간 화자 라벨은 대화 중 수정될 수 있습니다. 헤드폰 사용을 권장하며, 잘못 연결된 경우 세션을 다시 등록하세요. 공식 기준 최대 15명까지 설정할 수 있습니다.</p>
        <p className="mt-2 text-[12px] leading-5 text-inkSoft">실시간 처리 중 마이크 오디오와 입력한 참가자 이름이 Soniox로 전송되며 사용량 기반 비용이 발생할 수 있습니다. 이 통역 세션은 현재 회의 파일로 자동 저장하지 않습니다.</p>
      </section>

      <section aria-label="화자별 실시간 통역" className="grid gap-4 lg:grid-cols-2">
        {profiles.map((profile) => {
          const speaker = speakerMap[profile.id];
          const track = speaker ? capture.transcript.speakers?.[speaker] : undefined;
          return (
            <article key={profile.id} className="rounded-2xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[16px] font-bold text-ink" data-i18n-user-content>{profile.name}</h3>
                <span className="rounded-full bg-soft px-2 py-1 text-[11px] font-bold text-inkSoft">{profile.team === "ours" ? "우리 팀 · 상대 언어 TTS" : `상대 팀 · ${LANGUAGES.find((language) => language.value === ourLanguage)?.label ?? ourLanguage} 자막`}</span>
              </div>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-inkSoft">원문 STT</p>
              <p className="mt-1 min-h-12 whitespace-pre-wrap text-[15px] leading-6 text-ink" data-i18n-user-content>{track?.original.final}<span className="text-inkSoft">{track?.original.provisional}</span></p>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-inkSoft">실시간 번역</p>
              <p className="mt-1 min-h-12 whitespace-pre-wrap text-[15px] leading-6 text-accent" data-i18n-user-content>{track?.translation.final}<span className="text-inkSoft">{track?.translation.provisional}</span></p>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function NumberField({ label, value, maximum, disabled, onChange }: { label: string; value: number; maximum: number; disabled: boolean; onChange(value: number): void }) {
  return (
    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
      {label}
      <input type="number" aria-label={label} min={1} max={maximum} value={value} disabled={disabled} onChange={(event) => onChange(clampCount(event.target.value, maximum))} className="min-h-11 rounded-xl border border-line bg-bg px-3" />
    </label>
  );
}

function LanguageField({ label, value, disabled, onChange, options = LANGUAGES }: { label: string; value: string; disabled: boolean; onChange(value: string): void; options?: readonly { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
      {label}
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border border-line bg-bg px-3">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
