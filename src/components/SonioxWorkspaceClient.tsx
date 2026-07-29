"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useOptionalAppPreferences } from "@/components/AppPreferences";
import { useLibrary } from "@/components/LibraryProvider";
import { Recorder } from "@/components/Recorder";
import { RealTimeGlobalMeetingPanel } from "@/components/RealTimeGlobalMeetingPanel";
import { TestProductMeetingPanel } from "@/components/TestProductMeetingPanel";
import {
  type SonioxCapturePhase,
  type SonioxInputSource,
  useSonioxLiveCapture,
} from "@/components/useSonioxLiveCapture";
import { useSonioxTts } from "@/components/useSonioxTts";
import {
  buildSonioxToolHref,
  formatVoiceTypingText,
  resolveSonioxWorkspaceSelection,
  resolveVoiceTypingShortcut,
  type VoiceTypingShortcutMode,
} from "@/lib/sonioxWorkspace";
import {
  captureSonioxShortcut,
  formatSonioxShortcut,
  hasDefaultSonioxShortcut,
  matchSonioxShortcut,
  type SonioxShortcutAction,
  type SonioxShortcutBinding,
} from "@/lib/sonioxShortcuts";
import { useSonioxShortcutSettings } from "@/components/useSonioxShortcutSettings";
import { translateUi } from "@/lib/i18n";
import type { SonioxTranslationOptions } from "@/services/sonioxRealtime";

const LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
] as const;

const TTS_VOICES = ["Maya", "Daniel", "Mina", "Kenji"] as const;

const PHASE_LABELS: Record<SonioxCapturePhase, string> = {
  idle: "시작 전",
  requesting: "오디오 권한 확인 중…",
  connecting: "Soniox 연결 중…",
  listening: "실시간 처리 중",
  finishing: "마지막 문장 정리 중…",
  finished: "완료",
  error: "오류",
};

const VOICE_PHASE_LABELS: Record<VoiceTypingShortcutMode, Record<SonioxCapturePhase, string>> = {
  dictation: {
    idle: "시작 전",
    requesting: "받아쓰기 권한 확인 중…",
    connecting: "받아쓰기 연결 중…",
    listening: "받아쓰기 중",
    finishing: "받아쓰기 정리 중…",
    finished: "받아쓰기 추가됨",
    error: "받아쓰기 오류",
  },
  translation: {
    idle: "시작 전",
    requesting: "번역 입력 권한 확인 중…",
    connecting: "번역 입력 연결 중…",
    listening: "번역 중",
    finishing: "번역 정리 중…",
    finished: "번역 추가됨",
    error: "번역 입력 오류",
  },
};

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function isShortcutEditingNavigationKey(event: KeyboardEvent): boolean {
  if (event.code === "Tab") return true;
  return (event.code === "Enter" || event.code === "Space")
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey;
}

function TranscriptPanels({
  original,
  translation,
  translationLabel = "실시간 번역",
}: {
  original: { final: string; provisional: string };
  translation: { final: string; provisional: string };
  translationLabel?: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-panel p-5">
        <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-inkSoft">실시간 원문</p>
        <p data-i18n-user-content className="mt-3 min-h-28 whitespace-pre-wrap text-[16px] leading-7 text-ink">
          {original.final}<span className="text-inkSoft">{original.provisional}</span>
        </p>
      </section>
      <section className="rounded-2xl border border-line bg-panel p-5">
        <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-inkSoft">{translationLabel}</p>
        <p data-i18n-user-content className="mt-3 min-h-28 whitespace-pre-wrap text-[16px] leading-7 text-accent">
          {translation.final}<span className="text-inkSoft">{translation.provisional}</span>
        </p>
      </section>
    </div>
  );
}

function StatusPill({ phase, labels = PHASE_LABELS }: {
  phase: SonioxCapturePhase;
  labels?: Record<SonioxCapturePhase, string>;
}) {
  const active = phase === "listening";
  const toneClass = phase === "error"
    ? "bg-error/10 text-error"
    : phase === "finished"
      ? "bg-success/10 text-success"
      : active
        ? "bg-successBg text-success"
        : "bg-soft text-inkSoft";
  return (
    <span className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-[12px] font-semibold ${toneClass}`} role="status">
      {active && <span className="h-2 w-2 animate-pulse rounded-full bg-success motion-reduce:animate-none" aria-hidden="true" />}
      {labels[phase]}
    </span>
  );
}

const SHORTCUT_LABELS: Record<SonioxShortcutAction, string> = {
  translator: "Translator",
  dictation: "받아쓰기",
  translation: "번역 입력",
};

function ShortcutSettingCard({
  action,
  label,
  description,
  binding,
  editing,
  onEdit,
}: {
  action: SonioxShortcutAction;
  label: string;
  description: string;
  binding: SonioxShortcutBinding;
  editing: boolean;
  onEdit(action: SonioxShortcutAction): void;
}) {
  const preferences = useOptionalAppPreferences();
  const translate = preferences?.t ?? ((source: string, values = {}) => translateUi("ko", source, values));
  return (
    <div className={`rounded-xl border p-4 ${editing ? "border-accent bg-soft" : "border-line bg-soft/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] font-bold text-ink">{label}</span>
        <kbd className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-[12px] font-medium text-ink">
          {editing ? "새 키를 누르세요" : formatSonioxShortcut(binding)}
        </kbd>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-inkSoft">{description}</p>
      <button
        type="button"
        data-i18n-user-attributes
        aria-label={translate("{label} 단축키: {action}", {
          label: translate(label),
          action: translate(editing ? "변경 취소" : "변경"),
        })}
        aria-pressed={editing}
        onClick={() => onEdit(action)}
        className="mt-3 min-h-11 rounded-lg border border-line bg-panel px-3 text-[12px] font-bold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {editing ? "변경 취소" : "변경"}
      </button>
    </div>
  );
}

function TranscriptionTool({ workspaceId, folderId }: { workspaceId: string; folderId: string | null }) {
  return (
    <Recorder requestedLocation={{ workspaceId, folderId }} defaultTranscriptionMode="soniox" />
  );
}

function TestProductTool() {
  const capture = useSonioxLiveCapture();
  const speech = useSonioxTts();
  return <TestProductMeetingPanel capture={capture} speech={speech} />;
}

function TranslatorTool() {
  const capture = useSonioxLiveCapture();
  const speech = useSonioxTts();
  const { settings: shortcuts, settingsRef: shortcutsRef, storageWarning, assign: assignShortcut, reset: resetShortcuts } = useSonioxShortcutSettings();
  const [editingShortcut, setEditingShortcut] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [inputSource, setInputSource] = useState<SonioxInputSource>("microphone");
  const [translatorMode, setTranslatorMode] = useState<"one-way" | "global-meeting">("one-way");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [autoPlaySpeech, setAutoPlaySpeech] = useState(false);
  const [ttsVoice, setTtsVoice] = useState<(typeof TTS_VOICES)[number]>("Maya");
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const lastAutoPlayedRef = useRef("");
  const pending = capture.phase === "requesting" || capture.phase === "connecting";
  const busy = ["requesting", "connecting", "finishing"].includes(capture.phase);
  const listening = capture.phase === "listening";
  const translation: SonioxTranslationOptions = { mode: "one_way", targetLanguage };
  const captureRef = useLatestRef(capture);
  const speechRef = useLatestRef(speech);
  const editingShortcutRef = useLatestRef(editingShortcut);
  const inputSourceRef = useLatestRef(inputSource);
  const translationRef = useLatestRef(translation);
  const translatedSpeech = capture.transcript.translation.final.trim();

  const speakTranslation = () => {
    if (!translatedSpeech) return;
    void speech.speak({
      text: translatedSpeech,
      language: targetLanguage,
      voice: ttsVoice,
      speed: ttsSpeed,
    });
  };

  useEffect(() => {
    if (!autoPlaySpeech || capture.phase !== "finished" || !translatedSpeech) return;
    const playbackKey = `${targetLanguage}:${ttsVoice}:${ttsSpeed}:${translatedSpeech}`;
    if (lastAutoPlayedRef.current === playbackKey) return;
    lastAutoPlayedRef.current = playbackKey;
    void speech.speak({
      text: translatedSpeech,
      language: targetLanguage,
      voice: ttsVoice,
      speed: ttsSpeed,
    });
  }, [autoPlaySpeech, capture.phase, speech, targetLanguage, translatedSpeech, ttsSpeed, ttsVoice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingShortcutRef.current) {
        if (isShortcutEditingNavigationKey(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "Escape") {
          setEditingShortcut(false);
          setShortcutError(null);
          return;
        }
        const binding = captureSonioxShortcut(event);
        if (!binding) {
          setShortcutError("기능키를 누르거나 Alt, Control, Command가 포함된 조합을 입력해 주세요.");
          return;
        }
        const result = assignShortcut("translator", binding);
        if (!result.ok) {
          setShortcutError(`${SHORTCUT_LABELS[result.conflict]}에서 사용 중인 단축키입니다.`);
          return;
        }
        setEditingShortcut(false);
        setShortcutError(null);
        return;
      }
      if (!matchSonioxShortcut(event, shortcutsRef.current.translator)) return;
      if (translatorMode === "global-meeting") {
        event.preventDefault();
        return;
      }
      const currentCapture = captureRef.current;
      if (currentCapture.phase === "finishing") return;
      event.preventDefault();
      if (["listening", "requesting", "connecting"].includes(currentCapture.phase)) currentCapture.stop();
      else {
        speechRef.current.stop();
        void currentCapture.start({ inputSource: inputSourceRef.current, translation: translationRef.current });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assignShortcut, captureRef, editingShortcutRef, inputSourceRef, shortcutsRef, speechRef, translationRef, translatorMode]);

  const modeLocked = ["requesting", "connecting", "listening", "finishing"].includes(capture.phase)
    || ["connecting", "playing"].includes(speech.phase);

  const changeTranslatorMode = (mode: "one-way" | "global-meeting") => {
    if (mode === translatorMode || modeLocked) return;
    capture.stop();
    speech.stop();
    capture.reset();
    setTranslatorMode(mode);
  };

  if (translatorMode === "global-meeting") {
    return (
      <div className="space-y-5">
        <TranslatorModeSwitch mode={translatorMode} locked={modeLocked} onChange={changeTranslatorMode} />
        <RealTimeGlobalMeetingPanel capture={capture} speech={speech} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <TranslatorModeSwitch mode={translatorMode} locked={modeLocked} onChange={changeTranslatorMode} />
      <section className="rounded-2xl border border-line bg-panel p-5 shadow-[0_8px_30px_-20px_rgba(42,36,32,.3)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-ink">One-way Translator</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">듣기만 하는 상황에서 음성을 받아쓰고 선택한 언어로 한 방향 번역합니다.</p>
          </div>
          <StatusPill phase={capture.phase} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
            <span>오디오 입력</span>
            <select aria-label="오디오 입력" value={inputSource} onChange={(event) => setInputSource(event.target.value as SonioxInputSource)} disabled={listening || busy} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink">
              <option value="microphone">마이크 (대면·내 발화)</option>
              <option value="browser-tab">브라우저 탭 오디오 (Zoom·Google Meet 웹)</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
            <span>번역 언어</span>
            <select aria-label="번역 언어" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} disabled={listening || busy} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink">
              {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
            <span>번역 음성</span>
            <select
              aria-label="번역 음성"
              value={ttsVoice}
              onChange={(event) => setTtsVoice(event.target.value as (typeof TTS_VOICES)[number])}
              disabled={listening || busy}
              className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink disabled:opacity-50"
            >
              {TTS_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
            <span>음성 속도</span>
            <select
              aria-label="음성 속도"
              value={ttsSpeed}
              onChange={(event) => setTtsSpeed(Number(event.target.value))}
              disabled={listening || busy}
              className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink disabled:opacity-50"
            >
              <option value={0.8}>느리게 (0.8×)</option>
              <option value={1}>보통 (1.0×)</option>
              <option value={1.2}>빠르게 (1.2×)</option>
            </select>
          </label>
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-soft/40 p-4 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={autoPlaySpeech}
            onChange={(event) => {
              const enabled = event.target.checked;
              setAutoPlaySpeech(enabled);
              if (enabled) void speech.prepare();
            }}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            <span className="block font-semibold">번역 음성 자동 재생</span>
            <span className="mt-1 block leading-5 text-inkSoft">마이크를 끄고 번역이 끝난 뒤 Soniox 음성을 로컬 스피커로 재생해 피드백을 방지합니다.</span>
          </span>
        </label>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={capture.phase === "finishing"}
            onClick={listening || pending
              ? capture.stop
              : () => {
                  speech.stop();
                  void capture.start({ inputSource, translation });
                }}
            className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg hover:bg-accent disabled:opacity-50"
          >
            {listening ? "실시간 번역 중지" : pending ? "연결 취소" : "실시간 번역 시작"}
          </button>
          {speech.phase === "connecting" || speech.phase === "playing" ? (
            <button type="button" aria-label="번역 음성 중지" onClick={speech.stop} className="min-h-11 rounded-full border border-line px-5 text-[14px] font-semibold text-accent">
              {speech.phase === "connecting" ? "음성 연결 취소" : "번역 음성 중지"}
            </button>
          ) : (
            <button
              type="button"
              aria-label="번역 음성 듣기"
              disabled={!translatedSpeech || listening || busy}
              onClick={speakTranslation}
              className="min-h-11 rounded-full border border-line px-5 text-[14px] font-semibold text-accent disabled:opacity-40"
            >
              번역 음성 듣기
            </button>
          )}
          {(capture.phase === "finished" || capture.phase === "error") && (
            <button type="button" onClick={() => { speech.stop(); capture.reset(); lastAutoPlayedRef.current = ""; }} className="min-h-11 rounded-full border border-line px-5 text-[14px] font-semibold text-accent">새 세션</button>
          )}
        </div>
        <div className="mt-5">
          <ShortcutSettingCard
            action="translator"
            label="Translator"
            description="한 번 누르면 실시간 번역을 시작하고, 다시 누르면 중지합니다. 현재 탭에 포커스가 있을 때 동작합니다."
            binding={shortcuts.translator}
            editing={editingShortcut}
            onEdit={() => {
              setEditingShortcut((current) => !current);
              setShortcutError(null);
            }}
          />
          <button type="button" onClick={() => { resetShortcuts(); setShortcutError(null); }} className="mt-3 min-h-11 px-2 text-[12px] font-bold text-accent underline-offset-4 hover:underline">
            모든 단축키 기본값 복원
          </button>
        </div>
        {(shortcutError || storageWarning) && <p className="mt-3 text-[12px] font-medium text-error" role="alert">{shortcutError || storageWarning}</p>}
        {capture.error && <p className="mt-4 text-[13px] text-error" role="alert">{capture.error}</p>}
        {speech.error && <p className="mt-4 text-[13px] text-error" role="alert">{speech.error}</p>}
        <p className="mt-4 text-[12px] leading-5 text-inkSoft">
          한 방향 번역 결과는 로컬 스피커로 듣거나 완료 후 자동 재생할 수 있습니다. 회의 상대의 마이크 입력으로 자동 전송되지는 않습니다.
        </p>
      </section>

      {inputSource === "browser-tab" && (
        <section className="rounded-2xl border border-warn/40 bg-warnBg p-5 text-[13px] leading-6 text-ink">
          <h3 className="font-bold">Zoom·Google Meet 웹 회의에서 사용하기</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-inkSoft">
            <li>회의가 열린 브라우저 탭을 선택하세요.</li>
            <li>공유 창에서 탭 오디오 공유를 켜세요.</li>
            <li>상대방 음성이 이 화면에 번역 자막으로 표시됩니다.</li>
          </ol>
          <p className="mt-3 font-medium">웹 버전은 번역 음성을 회의 상대에게 자동으로 보내지는 않습니다. Zoom 데스크톱 앱의 시스템 오디오와 가상 마이크 연결은 향후 데스크톱 앱에서 지원할 범위입니다.</p>
        </section>
      )}

      <TranscriptPanels original={capture.transcript.original} translation={capture.transcript.translation} />
      <p className="text-[12px] leading-5 text-inkSoft">실시간 처리 중 오디오가 Soniox로 전송되며 사용량 기반 비용이 발생할 수 있습니다. 이 번역 세션은 현재 회의 파일로 자동 저장하지 않습니다.</p>
    </div>
  );
}

function TranslatorModeSwitch({ mode, locked, onChange }: { mode: "one-way" | "global-meeting"; locked: boolean; onChange(mode: "one-way" | "global-meeting"): void }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-panel p-1" role="group" aria-label="Translator 모드">
      <button type="button" aria-pressed={mode === "one-way"} disabled={locked && mode !== "one-way"} onClick={() => onChange("one-way")} className={`min-h-11 rounded-lg px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${mode === "one-way" ? "bg-ink text-bg" : "text-inkSoft"}`}>단방향 트랜스레이터</button>
      <button type="button" aria-pressed={mode === "global-meeting"} disabled={locked && mode !== "global-meeting"} onClick={() => onChange("global-meeting")} className={`min-h-11 rounded-lg px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${mode === "global-meeting" ? "bg-ink text-bg" : "text-inkSoft"}`}>실시간 글로벌 미팅</button>
    </div>
  );
}

function LanguageSelect({ label, value, onChange, disabled }: { label: string; value: string; onChange(value: string): void; disabled: boolean }) {
  return (
    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink">
        {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
      </select>
    </label>
  );
}

function VoiceTypingTool({ workspaceId }: { workspaceId: string }) {
  const capture = useSonioxLiveCapture();
  const { settings: shortcuts, settingsRef: shortcutsRef, storageWarning, assign: assignShortcut, reset: resetShortcuts } = useSonioxShortcutSettings();
  const [editingShortcut, setEditingShortcut] = useState<SonioxShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [output, setOutput] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const [smartCleanup, setSmartCleanup] = useState(true);
  const [activeMode, setActiveMode] = useState<VoiceTypingShortcutMode>("dictation");
  const modeRef = useRef<VoiceTypingShortcutMode>("dictation");
  const commandPendingRef = useRef(false);
  const processedTranscriptRef = useRef<typeof capture.transcript | null>(null);
  const lastPersistedDraftRef = useRef("");
  const captureRef = useLatestRef(capture);
  const editingShortcutRef = useLatestRef(editingShortcut);
  const targetLanguageRef = useLatestRef(targetLanguage);
  const pending = capture.phase === "requesting" || capture.phase === "connecting";
  const listening = capture.phase === "listening";
  const busy = ["requesting", "connecting", "finishing"].includes(capture.phase);

  useEffect(() => {
    const key = `ai-note-voice-typing-draft:${workspaceId}`;
    try {
      const stored = window.localStorage.getItem(key) ?? "";
      lastPersistedDraftRef.current = stored;
      setOutput(stored);
    } catch {
      setDraftWarning("브라우저 저장소를 사용할 수 없어 이 탭을 닫으면 입력 결과가 사라질 수 있습니다.");
    } finally {
      setDraftLoaded(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!draftLoaded || output === lastPersistedDraftRef.current) return;
    const key = `ai-note-voice-typing-draft:${workspaceId}`;
    try {
      if (output) window.localStorage.setItem(key, output);
      else window.localStorage.removeItem(key);
      lastPersistedDraftRef.current = output;
      setDraftWarning(null);
    } catch {
      setDraftWarning("브라우저 저장소를 사용할 수 없어 이 탭을 닫으면 입력 결과가 사라질 수 있습니다.");
    }
  }, [draftLoaded, output, workspaceId]);

  useEffect(() => {
    if (!["requesting", "connecting", "listening", "finishing"].includes(capture.phase)) {
      commandPendingRef.current = false;
    }
  }, [capture.phase]);

  const begin = (mode: VoiceTypingShortcutMode) => {
    if (commandPendingRef.current) return;
    commandPendingRef.current = true;
    modeRef.current = mode;
    setActiveMode(mode);
    const translation: SonioxTranslationOptions = mode === "translation"
      ? { mode: "one_way", targetLanguage }
      : { mode: "none" };
    void capture.start({ inputSource: "microphone", translation });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editingAction = editingShortcutRef.current;
      if (editingAction) {
        if (isShortcutEditingNavigationKey(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "Escape") {
          setEditingShortcut(null);
          setShortcutError(null);
          return;
        }
        const binding = captureSonioxShortcut(event);
        if (!binding) {
          setShortcutError("기능키를 누르거나 Alt, Control, Command가 포함된 조합을 입력해 주세요.");
          return;
        }
        const result = assignShortcut(editingAction, binding);
        if (!result.ok) {
          setShortcutError(`${SHORTCUT_LABELS[result.conflict]}에서 사용 중인 단축키입니다.`);
          return;
        }
        setEditingShortcut(null);
        setShortcutError(null);
        return;
      }
      const configuredMode = matchSonioxShortcut(event, shortcutsRef.current.dictation)
        ? "dictation"
        : matchSonioxShortcut(event, shortcutsRef.current.translation)
          ? "translation"
          : null;
      const legacyMode = resolveVoiceTypingShortcut(event);
      const mode = configuredMode ?? (
        legacyMode && hasDefaultSonioxShortcut(shortcutsRef.current, legacyMode)
          ? legacyMode
          : null
      );
      if (!mode) return;
      const currentCapture = captureRef.current;
      if (currentCapture.phase === "finishing") return;
      event.preventDefault();
      if (["listening", "requesting", "connecting"].includes(currentCapture.phase)) {
        currentCapture.stop();
        return;
      }
      if (commandPendingRef.current) return;
      commandPendingRef.current = true;
      modeRef.current = mode;
      setActiveMode(mode);
      const translation: SonioxTranslationOptions = mode === "translation"
        ? { mode: "one_way", targetLanguage: targetLanguageRef.current }
        : { mode: "none" };
      void currentCapture.start({ inputSource: "microphone", translation });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assignShortcut, captureRef, editingShortcutRef, shortcutsRef, targetLanguageRef]);

  useEffect(() => {
    if (capture.phase !== "finished" || processedTranscriptRef.current === capture.transcript) return;
    processedTranscriptRef.current = capture.transcript;
    const track = modeRef.current === "translation" ? capture.transcript.translation : capture.transcript.original;
    const formatted = formatVoiceTypingText(track.final, { enabled: smartCleanup });
    setOutput((current) => [current.trim(), formatted].filter(Boolean).join(current.trim() ? "\n" : ""));
  }, [capture.phase, capture.transcript, smartCleanup]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5 shadow-[0_8px_30px_-20px_rgba(42,36,32,.3)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-ink">입력 설정</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">말한 내용을 실시간으로 받아쓰거나 선택한 언어로 번역해 편집기에 추가합니다.</p>
          </div>
          <StatusPill phase={capture.phase} labels={VOICE_PHASE_LABELS[activeMode]} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ShortcutSettingCard
            action="dictation"
            label="받아쓰기"
            description="한 번 누르면 받아쓰기를 시작하고, 다시 누르면 중지합니다."
            binding={shortcuts.dictation}
            editing={editingShortcut === "dictation"}
            onEdit={(action) => {
              setEditingShortcut((current) => current === action ? null : action);
              setShortcutError(null);
            }}
          />
          <ShortcutSettingCard
            action="translation"
            label="번역 입력"
            description="선택한 언어로 번역해 입력합니다."
            binding={shortcuts.translation}
            editing={editingShortcut === "translation"}
            onEdit={(action) => {
              setEditingShortcut((current) => current === action ? null : action);
              setShortcutError(null);
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] leading-5 text-inkSoft">변경을 누른 뒤 새 키 조합을 입력해 주세요. Escape를 누르면 취소합니다.</p>
          <button type="button" onClick={() => { resetShortcuts(); setEditingShortcut(null); setShortcutError(null); }} className="min-h-11 px-2 text-[12px] font-bold text-accent underline-offset-4 hover:underline">
            모든 단축키 기본값 복원
          </button>
        </div>
        {(shortcutError || storageWarning) && <p className="mt-2 text-[12px] font-medium text-error" role="alert">{shortcutError || storageWarning}</p>}

        <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-end">
          <LanguageSelect label="번역 대상 언어" value={targetLanguage} onChange={setTargetLanguage} disabled={listening || busy} />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row md:justify-end">
            <button type="button" disabled={capture.phase === "finishing"} onClick={listening || pending ? capture.stop : () => begin("dictation")} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg disabled:opacity-50">{listening ? "입력 종료" : pending ? "연결 취소" : "받아쓰기 시작"}</button>
            {!listening && <button type="button" disabled={busy} onClick={() => begin("translation")} className="min-h-11 rounded-full border border-line px-5 text-[14px] font-semibold text-accent disabled:opacity-50">번역해서 입력</button>}
          </div>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-soft/40 p-4 text-[13px] text-ink">
          <input type="checkbox" checked={smartCleanup} onChange={(event) => setSmartCleanup(event.target.checked)} disabled={listening || busy} className="mt-0.5 h-4 w-4 accent-accent" />
          <span>
            <span className="block font-semibold">깔끔하게 입력</span>
            <span className="mt-1 block leading-5 text-inkSoft">음·어·um 같은 불필요한 말과 바로 반복된 단어, 문장부호 앞 공백을 정리합니다. 끄면 Soniox 결과를 그대로 추가합니다.</span>
          </span>
        </label>
        {capture.error && <p className="mt-4 text-[13px] text-error" role="alert">{capture.error}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="voice-typing-output" className="text-[14px] font-bold text-ink">입력 결과</label>
          <button type="button" disabled={!output} onClick={() => void navigator.clipboard?.writeText(output)} className="min-h-11 rounded-full border border-line px-4 text-[12px] font-semibold text-accent disabled:opacity-40">복사</button>
        </div>
        <textarea id="voice-typing-output" value={output} onChange={(event) => setOutput(event.target.value)} placeholder="받아쓰기 또는 번역 결과가 여기에 추가됩니다." className="mt-3 min-h-48 w-full resize-y rounded-xl border border-line bg-bg p-4 text-[15px] leading-7 text-ink" />
        <p className="mt-2 text-[12px] leading-5 text-inkSoft">입력 결과는 이 브라우저의 현재 워크스페이스 초안으로 자동 저장됩니다.</p>
        {draftWarning && <p className="mt-2 text-[12px] font-medium text-warn" role="alert">{draftWarning}</p>}
        {(capture.transcript.original.final || capture.transcript.original.provisional) && capture.phase !== "finished" && (
          <p data-i18n-user-content className="mt-3 whitespace-pre-wrap text-[13px] text-inkSoft">{capture.transcript.original.final}{capture.transcript.original.provisional}</p>
        )}
      </section>

      <section className="rounded-2xl border border-warn/40 bg-warnBg p-5 text-[13px] leading-6 text-ink">
        <h3 className="font-bold">웹 단축키 범위</h3>
        <p className="mt-2 text-inkSoft">웹에서는 현재 탭에 포커스가 있을 때만 단축키를 감지할 수 있습니다. 기본값은 Option+Shift+D와 Option+Shift+V입니다. 기본 설정에서는 기존 Fn/F8과 Shift+Fn/F8도 함께 동작하지만, 브라우저가 Fn 키를 전달하지 않을 수 있습니다. 해당 기능의 단축키를 변경하면 기존 대체키는 해제됩니다. 다른 앱의 커서 위치에 직접 삽입하는 전역 입력은 향후 데스크톱 앱에서 접근성 권한을 받은 뒤 지원합니다.</p>
      </section>
      <p className="text-[12px] leading-5 text-inkSoft">받아쓰기 중 마이크 오디오가 Soniox로 전송되며 사용량 기반 비용이 발생할 수 있습니다.</p>
    </div>
  );
}

export function SonioxWorkspaceClient() {
  const libraryState = useLibrary();
  const router = useRouter();
  const search = useSearchParams();
  const searchValue = search.toString();
  const resolvedSelection = libraryState.library
    ? resolveSonioxWorkspaceSelection(new URLSearchParams(searchValue), libraryState.library)
    : null;
  const canonicalHref = resolvedSelection ? buildSonioxToolHref(resolvedSelection) : null;

  useEffect(() => {
    if (!canonicalHref) return;
    const canonicalSearch = canonicalHref.slice(canonicalHref.indexOf("?") + 1);
    if (searchValue !== canonicalSearch) router.replace(canonicalHref);
  }, [canonicalHref, router, searchValue]);

  if (libraryState.mode === "loading") {
    return <main id="main" className="px-6 py-12 text-[14px] text-inkSoft" aria-busy="true">Soniox 작업 영역을 불러오는 중…</main>;
  }
  if (!libraryState.library || !resolvedSelection) {
    return <main id="main" className="px-6 py-12"><h1 className="text-2xl font-bold text-ink">Soniox</h1><p className="mt-3 text-[14px] text-error">워크스페이스 정보를 불러온 뒤 사용할 수 있습니다.</p></main>;
  }

  const selection = resolvedSelection;
  const workspace = libraryState.library.workspaces.find((item) => item.id === selection.workspaceId);
  const folder = selection.folderId ? libraryState.library.folders.find((item) => item.id === selection.folderId) : null;
  const headings = {
    transcription: ["Smart Scribe", "회의를 녹음하고 실시간 원문을 확인한 뒤 로컬 최종 전사로 저장합니다."],
    translator: ["Translator", "Zoom·Google Meet 웹 탭 또는 마이크 음성을 실시간 번역합니다."],
    "test-product": ["테스트 프로덕트", "자동 화자 구분과 스페이스바 Push-to-Talk 송출을 실험합니다."],
    "voice-typing": ["Voice Typing", "단축키로 받아쓰기와 번역 입력을 전환합니다."],
  } as const;
  const [title, description] = headings[selection.tool];

  return (
    <main id="main" className="w-full max-w-6xl space-y-7 px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-[15px] leading-6 text-inkSoft">{description}</p>
        {selection.tool === "transcription" && (
          <p className="mt-3 text-[13px] font-medium text-inkSoft">
            저장 위치 · {workspace ? <span data-i18n-user-content>{workspace.name}</span> : "워크스페이스"} / {folder ? <span data-i18n-user-content>{folder.name}</span> : "미분류"}
          </p>
        )}
      </header>
      {selection.tool === "transcription" && <TranscriptionTool workspaceId={selection.workspaceId} folderId={selection.folderId} />}
      {selection.tool === "translator" && <TranslatorTool />}
      {selection.tool === "test-product" && <TestProductTool />}
      {selection.tool === "voice-typing" && <VoiceTypingTool key={selection.workspaceId} workspaceId={selection.workspaceId} />}
    </main>
  );
}
