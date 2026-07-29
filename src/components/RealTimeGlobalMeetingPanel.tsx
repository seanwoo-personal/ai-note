"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type useSonioxLiveCapture } from "@/components/useSonioxLiveCapture";
import { type useSonioxTts } from "@/components/useSonioxTts";

const LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
] as const;

type Capture = ReturnType<typeof useSonioxLiveCapture>;
type Speech = ReturnType<typeof useSonioxTts>;
type GroupId = "A" | "B";

type Participant = {
  id: string;
  ordinal: number;
  name: string;
  group: GroupId;
};

type TranslationJob = {
  id: number;
  participantName: string;
  original: string;
  targetLanguage: string;
  destination: GroupId;
};

type TranslationEntry = TranslationJob & { translation: string };

function hasUtteranceAwaitingEndpoint(transcript: Capture["transcript"]): boolean {
  if (transcript.original.provisional.trim() || transcript.translation.provisional.trim()) return true;
  const speaker = transcript.activeSpeaker;
  if (!speaker) return false;
  const track = transcript.speakers?.[speaker];
  if (!track) return false;
  const endpoint = [...(transcript.endpoints ?? [])].reverse().find((item) => item.speaker === speaker);
  return endpoint ? track.original.final !== endpoint.originalFinal : Boolean(track.original.final.trim());
}

function clampParticipantCount(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(2, Math.min(15, parsed));
}

export function RealTimeGlobalMeetingPanel({ capture, speech }: { capture: Capture; speech: Speech }) {
  const [participantCount, setParticipantCount] = useState(4);
  const [names, setNames] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Record<string, GroupId>>({});
  const [groupATarget, setGroupATarget] = useState("ja");
  const [groupBTarget, setGroupBTarget] = useState("ko");
  const [groupLanguages, setGroupLanguages] = useState<Record<GroupId, string[]>>({
    A: ["ko", "en"],
    B: ["ja", "en"],
  });
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [pendingParticipant, setPendingParticipant] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ participantId: string; speaker: string } | null>(null);
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(null);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [translationQueue, setTranslationQueue] = useState<TranslationJob[]>([]);
  const [translations, setTranslations] = useState<Record<GroupId, TranslationEntry[]>>({ A: [], B: [] });
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechQueue, setSpeechQueue] = useState<Array<{ id: number; text: string; language: string }>>([]);
  const endpointAtRegistrationRef = useRef(0);
  const lastMeetingEndpointRef = useRef(0);
  const originalLengthsRef = useRef<Record<string, number>>({});
  const generationRef = useRef(0);
  const processingRef = useRef(false);
  const speechProcessingRef = useRef(false);
  const translationAbortRef = useRef<AbortController | null>(null);
  const captureStopRef = useRef(capture.stop);
  const speechStopRef = useRef(speech.stop);
  captureStopRef.current = capture.stop;
  speechStopRef.current = speech.stop;

  const participants = useMemo<Participant[]>(() => Array.from({ length: participantCount }, (_, index) => {
    const ordinal = index + 1;
    const id = `speaker_${ordinal}`;
    return {
      id,
      ordinal,
      name: names[id] || `화자 ${ordinal}`,
      group: groups[id] || (ordinal <= Math.ceil(participantCount / 2) ? "A" : "B"),
    };
  }), [groups, names, participantCount]);

  const listening = capture.phase === "listening";
  const pending = capture.phase === "requesting" || capture.phase === "connecting";
  const allRegistered = participants.every((participant) => speakerMap[participant.id]);

  useEffect(() => {
    if (!pendingParticipant || capture.transcript.endpointCount <= endpointAtRegistrationRef.current) return;
    const endpoint = capture.transcript.endpoints?.find((item) => item.id > endpointAtRegistrationRef.current);
    endpointAtRegistrationRef.current = endpoint?.id ?? capture.transcript.endpointCount;
    const speaker = endpoint?.speaker ?? capture.transcript.lastEndpointSpeaker;
    if (!speaker) {
      setPendingParticipant(null);
      setRegistrationMessage("화자를 구분하지 못했습니다. 같은 화자가 다시 말해 주세요.");
      return;
    }
    if (Object.entries(speakerMap).some(([participantId, mapped]) => mapped === speaker && participantId !== pendingParticipant)) {
      setPendingParticipant(null);
      setRegistrationMessage("이미 다른 화자에 연결된 목소리입니다. 다시 말해 주세요.");
      return;
    }
    setCandidate({ participantId: pendingParticipant, speaker });
    setPendingParticipant(null);
    setRegistrationMessage("감지된 세션 화자 번호를 확인해 주세요.");
  }, [capture.transcript.endpointCount, capture.transcript.endpoints, capture.transcript.lastEndpointSpeaker, pendingParticipant, speakerMap]);

  useEffect(() => {
    if (!meetingStarted || capture.transcript.endpointCount <= lastMeetingEndpointRef.current) return;
    const endpoints = (capture.transcript.endpoints ?? []).filter((item) => item.id > lastMeetingEndpointRef.current);
    lastMeetingEndpointRef.current = capture.transcript.endpointCount;
    const jobs: TranslationJob[] = [];
    for (const endpoint of endpoints) {
      if (!endpoint.speaker) continue;
      const participant = participants.find((item) => speakerMap[item.id] === endpoint.speaker);
      if (!participant) continue;
      const previousLength = originalLengthsRef.current[endpoint.speaker] ?? 0;
      const original = endpoint.originalFinal.slice(previousLength).trim();
      originalLengthsRef.current[endpoint.speaker] = endpoint.originalFinal.length;
      if (!original) continue;
      jobs.push({
        id: endpoint.id,
        participantName: participant.name,
        original,
        targetLanguage: participant.group === "A" ? groupATarget : groupBTarget,
        destination: participant.group === "A" ? "B" : "A",
      });
    }
    if (jobs.length) setTranslationQueue((current) => [...current, ...jobs]);
  }, [capture.transcript, groupATarget, groupBTarget, meetingStarted, participants, speakerMap]);

  useEffect(() => {
    if (!meetingStarted || processingRef.current || translationQueue.length === 0) return;
    const job = translationQueue[0];
    const generation = generationRef.current;
    const controller = new AbortController();
    processingRef.current = true;
    translationAbortRef.current = controller;
    setTranslationError(null);
    void fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: job.original, targetLanguage: job.targetLanguage }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { translation?: unknown };
      if (!response.ok || typeof payload.translation !== "string" || !payload.translation.trim()) throw new Error("translation_failed");
      if (generationRef.current !== generation) return;
      const translated = payload.translation.trim();
      setTranslations((current) => ({
        ...current,
        [job.destination]: [...current[job.destination], { ...job, translation: translated }],
      }));
      if (autoSpeak) setSpeechQueue((current) => [...current, { id: job.id, text: translated, language: job.targetLanguage }]);
    }).catch((error: unknown) => {
      if ((error as { name?: string }).name !== "AbortError" && generationRef.current === generation) {
        setTranslationError(`${job.participantName}의 문장을 번역하지 못했습니다. 다음 문장은 계속 처리합니다.`);
      }
    }).finally(() => {
      if (generationRef.current === generation) {
        setTranslationQueue((current) => current[0]?.id === job.id ? current.slice(1) : current.filter((item) => item.id !== job.id));
      }
      if (translationAbortRef.current === controller) translationAbortRef.current = null;
      processingRef.current = false;
    });
  }, [autoSpeak, meetingStarted, translationQueue]);

  useEffect(() => {
    if (!meetingStarted || speechProcessingRef.current || speechQueue.length === 0 || !["idle", "finished", "error"].includes(speech.phase)) return;
    const item = speechQueue[0];
    const generation = generationRef.current;
    speechProcessingRef.current = true;
    void speech.speak({ text: item.text, language: item.language, voice: "Maya", speed: 1 }).catch(() => {
      if (generationRef.current === generation) setTranslationError("번역문은 표시했지만 음성으로 재생하지 못했습니다.");
    }).finally(() => {
      if (generationRef.current === generation) {
        setSpeechQueue((current) => current[0]?.id === item.id ? current.slice(1) : current.filter((queued) => queued.id !== item.id));
      }
      speechProcessingRef.current = false;
    });
  }, [meetingStarted, speech, speech.phase, speechQueue]);

  useEffect(() => () => {
    generationRef.current += 1;
    translationAbortRef.current?.abort();
    captureStopRef.current();
    speechStopRef.current();
  }, []);

  const beginRegistration = () => {
    generationRef.current += 1;
    translationAbortRef.current?.abort();
    processingRef.current = false;
    setSpeakerMap({});
    setPendingParticipant(null);
    setCandidate(null);
    setMeetingStarted(false);
    setTranslationQueue([]);
    setSpeechQueue([]);
    setTranslations({ A: [], B: [] });
    setTranslationError(null);
    setRegistrationMessage(null);
    speech.stop();
    capture.reset();
    void capture.start({
      inputSource: "microphone",
      translation: { mode: "none" },
      context: {
        general: [{
          key: "speakers",
          value: [
            ...participants.map((participant) => `${participant.name} (그룹 ${participant.group})`),
            `그룹 A 발화 언어: ${groupLanguages.A.map((code) => LANGUAGES.find((language) => language.value === code)?.label ?? code).join(", ")}; 상대 번역: ${LANGUAGES.find((language) => language.value === groupATarget)?.label}`,
            `그룹 B 발화 언어: ${groupLanguages.B.map((code) => LANGUAGES.find((language) => language.value === code)?.label ?? code).join(", ")}; 상대 번역: ${LANGUAGES.find((language) => language.value === groupBTarget)?.label}`,
          ].join(" / "),
        }],
        terms: participants.map((participant) => participant.name),
      },
    });
  };

  const beginMeeting = () => {
    if (!allRegistered || candidate) return;
    lastMeetingEndpointRef.current = capture.transcript.endpointCount;
    originalLengthsRef.current = Object.fromEntries(
      Object.entries(capture.transcript.speakers ?? {}).map(([speaker, track]) => [speaker, track.original.final.length]),
    );
    setMeetingStarted(true);
    setRegistrationMessage("실시간 글로벌 미팅을 시작했습니다. 문장이 끝날 때마다 상대 그룹 화면으로 번역합니다.");
  };

  const stopSession = () => {
    generationRef.current += 1;
    translationAbortRef.current?.abort();
    processingRef.current = false;
    capture.stop();
    speech.stop();
    setPendingParticipant(null);
    setCandidate(null);
    setMeetingStarted(false);
    setTranslationQueue([]);
    setSpeechQueue([]);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
        <div>
          <h2 className="text-[20px] font-bold text-ink">Real-time Global Meeting</h2>
          <p className="mt-2 text-[13px] leading-6 text-inkSoft">참석자를 현재 Soniox 세션의 화자 번호에 연결하고, 그룹별 언어로 상대 화면에 번역합니다.</p>
        </div>

        <label className="mt-5 flex max-w-sm flex-col gap-2 text-[13px] font-semibold text-ink">
          회의 참석자 수
          <input
            type="number"
            aria-label="회의 참석자 수"
            min={2}
            max={15}
            value={participantCount}
            disabled={listening || pending}
            onChange={(event) => setParticipantCount(clampParticipantCount(event.target.value))}
            className="min-h-11 rounded-xl border border-line bg-bg px-3"
          />
        </label>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <GroupSettings
            id="A"
            sourceLanguages={groupLanguages.A}
            targetLanguage={groupATarget}
            onSourceLanguagesChange={(languages) => setGroupLanguages((current) => ({ ...current, A: languages }))}
            onTargetLanguageChange={setGroupATarget}
          />
          <GroupSettings
            id="B"
            sourceLanguages={groupLanguages.B}
            targetLanguage={groupBTarget}
            onSourceLanguagesChange={(languages) => setGroupLanguages((current) => ({ ...current, B: languages }))}
            onTargetLanguageChange={setGroupBTarget}
          />
        </div>

        <label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl border border-line bg-bg px-4 text-[13px] font-semibold text-ink">
          <input type="checkbox" checked={autoSpeak} onChange={(event) => {
            setAutoSpeak(event.target.checked);
            if (!event.target.checked) {
              setSpeechQueue([]);
              speech.stop();
            }
          }} className="h-4 w-4 accent-accent" />
          완료된 번역을 순서대로 음성 출력
        </label>

        <div className="mt-4 rounded-xl border border-line bg-soft/40 p-4 text-[12px] leading-5 text-inkSoft">
          시작하면 참가자 이름과 마이크 음성이 Soniox에 전송되고 사용량 기반 비용이 발생합니다. 완료된 발화의 텍스트는 설정된 요약 모델로 보내 번역합니다. 결과는 이 화면에만 표시되며 회의 기록으로 자동 저장하지 않습니다. 같은 공간에서 음성을 재생하면 마이크 울림이 생길 수 있습니다.
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {participants.map((participant) => (
            <article key={participant.id} className="rounded-xl border border-line bg-soft/40 p-4">
              <label className="block text-[12px] font-bold text-inkSoft">
                화자 {participant.ordinal} 이름
                <input
                  aria-label={`화자 ${participant.ordinal} 이름`}
                  value={participant.name}
                  onChange={(event) => setNames((current) => ({ ...current, [participant.id]: event.target.value }))}
                  className="mt-2 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-[14px] text-ink"
                />
              </label>
              <label className="mt-3 block text-[12px] font-bold text-inkSoft">
                화자 {participant.ordinal} 그룹
                <select
                  aria-label={`화자 ${participant.ordinal} 그룹`}
                  value={participant.group}
                  onChange={(event) => setGroups((current) => ({ ...current, [participant.id]: event.target.value as GroupId }))}
                  className="mt-2 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-[14px] text-ink"
                >
                  <option value="A">그룹 A</option>
                  <option value="B">그룹 B</option>
                </select>
              </label>
              <div className="mt-3 flex min-h-11 items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-inkSoft">
                  {speakerMap[participant.id]
                    ? `등록됨 · 세션 화자 ${speakerMap[participant.id]}`
                    : pendingParticipant === participant.id
                      ? "목소리 듣는 중…"
                      : candidate?.participantId === participant.id
                        ? "화자 확인 대기"
                        : "미등록"}
                </span>
                {listening && !meetingStarted && (
                  <button
                    type="button"
                    aria-label={`화자 ${participant.ordinal} 등록`}
                    disabled={Boolean(pendingParticipant || candidate)}
                    onClick={() => {
                      if (hasUtteranceAwaitingEndpoint(capture.transcript)) {
                        setRegistrationMessage("현재 문장이 끝난 뒤 다시 눌러 주세요.");
                        return;
                      }
                      endpointAtRegistrationRef.current = capture.transcript.endpointCount;
                      setPendingParticipant(participant.id);
                      setRegistrationMessage(`“안녕하세요, ${participant.name}입니다”라고 말해 주세요.`);
                    }}
                    className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[12px] font-bold text-accent disabled:opacity-40"
                  >
                    등록
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>

        {candidate && (
          <div className="mt-4 rounded-xl border border-accent/40 bg-soft p-4" role="group" aria-label="감지된 화자 확인">
            <p className="text-[13px] font-semibold text-ink">
              {participants.find((participant) => participant.id === candidate.participantId)?.name} 님을 세션 화자 {candidate.speaker}로 연결할까요?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => {
                setSpeakerMap((current) => ({ ...current, [candidate.participantId]: candidate.speaker }));
                setCandidate(null);
                setRegistrationMessage("현재 세션의 화자 번호를 연결했습니다.");
              }} className="min-h-11 rounded-lg bg-accent px-4 text-[13px] font-bold text-white">이 화자로 확인</button>
              <button type="button" onClick={() => {
                setCandidate(null);
                setRegistrationMessage("같은 화자가 한 문장을 다시 말해 주세요.");
              }} className="min-h-11 rounded-lg border border-line bg-panel px-4 text-[13px] font-bold text-accent">다시 말하기</button>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!listening && !pending ? (
            <button type="button" onClick={beginRegistration} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-bold text-bg">화자 등록 시작</button>
          ) : !meetingStarted ? (
            <>
              <button type="button" disabled={!allRegistered || Boolean(pendingParticipant || candidate)} onClick={beginMeeting} className="min-h-11 rounded-full bg-accent px-5 text-[14px] font-bold text-white disabled:opacity-40">글로벌 미팅 시작</button>
              <button type="button" onClick={stopSession} className="min-h-11 rounded-full border border-line px-5 text-[14px] font-bold text-accent">등록 취소</button>
            </>
          ) : (
            <button type="button" onClick={stopSession} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-bold text-bg">글로벌 미팅 중지</button>
          )}
        </div>
        {registrationMessage && <p role="status" className="mt-4 text-[13px] font-medium text-ink">{registrationMessage}</p>}
        {translationError && <p role="alert" className="mt-3 text-[13px] font-medium text-error">{translationError}</p>}
        <p className="mt-4 text-[12px] leading-5 text-inkSoft">목소리를 영구 학습하거나 생체정보로 저장하지 않습니다. 현재 연결된 Soniox 세션의 화자 번호만 참가자와 연결하며, 세션이 바뀌면 다시 등록해야 합니다.</p>
      </section>

      <section aria-label="그룹별 실시간 번역" className="grid gap-4 lg:grid-cols-2">
        <GroupWindow id="A" targetLanguage={groupBTarget} entries={translations.A} />
        <GroupWindow id="B" targetLanguage={groupATarget} entries={translations.B} />
      </section>
    </div>
  );
}

function GroupSettings({
  id,
  sourceLanguages,
  targetLanguage,
  onSourceLanguagesChange,
  onTargetLanguageChange,
}: {
  id: GroupId;
  sourceLanguages: string[];
  targetLanguage: string;
  onSourceLanguagesChange(languages: string[]): void;
  onTargetLanguageChange(language: string): void;
}) {
  return (
    <fieldset className="rounded-xl border border-line bg-soft/40 p-4">
      <legend className="px-1 text-[14px] font-bold text-ink">그룹 {id} 언어 설정</legend>
      <p className="mt-1 text-[12px] leading-5 text-inkSoft">이 그룹이 말할 수 있는 언어와 상대 화면에 보낼 번역 언어입니다. 미팅 중에도 바꿀 수 있습니다.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {LANGUAGES.map((language) => {
          const checked = sourceLanguages.includes(language.value);
          return (
            <label key={language.value} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[12px] font-semibold text-ink">
              <input
                type="checkbox"
                aria-label={`그룹 ${id} ${language.label}`}
                checked={checked}
                onChange={() => {
                  if (checked && sourceLanguages.length === 1) return;
                  onSourceLanguagesChange(checked
                    ? sourceLanguages.filter((value) => value !== language.value)
                    : [...sourceLanguages, language.value]);
                }}
                className="h-4 w-4 accent-accent"
              />
              {language.label}
            </label>
          );
        })}
      </div>
      <label className="mt-3 flex flex-col gap-2 text-[12px] font-bold text-inkSoft">
        상대 번역 언어
        <select aria-label={`그룹 ${id} 상대 번역 언어`} value={targetLanguage} onChange={(event) => onTargetLanguageChange(event.target.value)} className="min-h-11 rounded-lg border border-line bg-bg px-3 text-[13px] text-ink">
          {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

function GroupWindow({ id, targetLanguage, entries }: { id: GroupId; targetLanguage: string; entries: TranslationEntry[] }) {
  const language = LANGUAGES.find((candidate) => candidate.value === targetLanguage)?.label ?? targetLanguage;
  return (
    <section aria-label={`그룹 ${id} 화면`} className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-bold text-ink">그룹 {id} 화면</h3>
          <p className="mt-1 text-[12px] text-inkSoft">상대 그룹 발언을 {language}로 표시</p>
        </div>
        <span className="rounded-full bg-soft px-3 py-2 text-[12px] font-bold text-accent">{language}</span>
      </div>
      <div className="mt-4 min-h-40 space-y-3 rounded-xl bg-soft/40 p-4 text-[14px] leading-6 text-inkSoft">
        {entries.length === 0 ? "번역 대기 중" : entries.map((entry) => (
          <article key={entry.id} className="rounded-lg border border-line bg-panel p-3">
            <p className="text-[12px] font-bold text-inkSoft" data-i18n-user-content>{entry.participantName}</p>
            <p className="mt-1 text-[13px] text-ink" data-i18n-user-content>{entry.original}</p>
            <p className="mt-2 text-[15px] font-semibold text-accent" data-i18n-user-content>{entry.translation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
