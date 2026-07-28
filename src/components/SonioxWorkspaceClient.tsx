"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useLibrary } from "@/components/LibraryProvider";
import { Recorder } from "@/components/Recorder";
import {
  type SonioxCapturePhase,
  type SonioxInputSource,
  useSonioxLiveCapture,
} from "@/components/useSonioxLiveCapture";
import {
  buildSonioxToolHref,
  formatVoiceTypingText,
  resolveSonioxWorkspaceSelection,
  resolveVoiceTypingShortcut,
  type VoiceTypingShortcutMode,
} from "@/lib/sonioxWorkspace";
import type { SonioxTranslationOptions } from "@/services/sonioxRealtime";

const LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh", label: "중국어" },
] as const;

const PHASE_LABELS: Record<SonioxCapturePhase, string> = {
  idle: "준비됨",
  requesting: "오디오 권한 확인 중…",
  connecting: "Soniox 연결 중…",
  listening: "실시간 처리 중",
  finishing: "마지막 문장 정리 중…",
  finished: "완료",
  error: "오류",
};

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
        <p className="mt-3 min-h-28 whitespace-pre-wrap text-[16px] leading-7 text-ink">
          {original.final}<span className="text-inkSoft">{original.provisional}</span>
        </p>
      </section>
      <section className="rounded-2xl border border-line bg-panel p-5">
        <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-inkSoft">{translationLabel}</p>
        <p className="mt-3 min-h-28 whitespace-pre-wrap text-[16px] leading-7 text-accent">
          {translation.final}<span className="text-inkSoft">{translation.provisional}</span>
        </p>
      </section>
    </div>
  );
}

function StatusPill({ phase }: { phase: SonioxCapturePhase }) {
  const active = phase === "listening";
  return (
    <span className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-[12px] font-semibold ${
      active ? "bg-error/10 text-error" : "bg-soft text-inkSoft"
    }`} role="status">
      {active && <span className="h-2 w-2 animate-pulse rounded-full bg-error motion-reduce:animate-none" aria-hidden="true" />}
      {PHASE_LABELS[phase]}
    </span>
  );
}

function TranscriptionTool({ workspaceId, folderId }: { workspaceId: string; folderId: string | null }) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-soft/45 p-5">
        <h2 className="text-[15px] font-bold text-ink">Soniox 실시간 전사</h2>
        <p className="mt-2 text-[13px] leading-6 text-inkSoft">
          녹음 중 Soniox 원문을 확인하고, 종료 후에는 원본 오디오와 로컬 Whisper 최종 전사를 이 폴더에 저장합니다.
        </p>
      </section>
      <Recorder requestedLocation={{ workspaceId, folderId }} defaultTranscriptionMode="soniox" />
    </div>
  );
}

function TranslatorTool() {
  const capture = useSonioxLiveCapture();
  const [inputSource, setInputSource] = useState<SonioxInputSource>("microphone");
  const [translationType, setTranslationType] = useState<"one_way" | "two_way">("one_way");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [languageA, setLanguageA] = useState("ko");
  const [languageB, setLanguageB] = useState("en");
  const pending = capture.phase === "requesting" || capture.phase === "connecting";
  const busy = ["requesting", "connecting", "finishing"].includes(capture.phase);
  const listening = capture.phase === "listening";
  const translation: SonioxTranslationOptions = translationType === "one_way"
    ? { mode: "one_way", targetLanguage }
    : { mode: "two_way", languageA, languageB };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-5 shadow-[0_8px_30px_-20px_rgba(42,36,32,.3)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-ink">실시간 번역 설정</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">한국어·영어·일본어·중국어 음성을 자동 감지해 실시간 자막으로 번역합니다.</p>
          </div>
          <StatusPill phase={capture.phase} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-[13px] font-semibold text-ink">
            <span>오디오 입력</span>
            <select aria-label="오디오 입력" value={inputSource} onChange={(event) => setInputSource(event.target.value as SonioxInputSource)} disabled={listening || busy} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink">
              <option value="microphone">마이크 (대면·내 발화)</option>
              <option value="browser-tab">브라우저 탭 오디오 (Zoom·Google Meet 웹)</option>
            </select>
          </label>
          <label className="space-y-2 text-[13px] font-semibold text-ink">
            <span>번역 방식</span>
            <select aria-label="번역 방식" value={translationType} onChange={(event) => setTranslationType(event.target.value as "one_way" | "two_way")} disabled={listening || busy} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink">
              <option value="one_way">감지한 언어 → 선택 언어</option>
              <option value="two_way">지정한 두 언어 양방향</option>
            </select>
          </label>
          {translationType === "one_way" ? (
            <label className="space-y-2 text-[13px] font-semibold text-ink md:col-span-2">
              <span>번역 언어</span>
              <select aria-label="번역 언어" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} disabled={listening || busy} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink md:max-w-sm">
                {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
              </select>
            </label>
          ) : (
            <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
              <LanguageSelect label="언어 A" value={languageA} onChange={setLanguageA} disabled={listening || busy} />
              <LanguageSelect label="언어 B" value={languageB} onChange={setLanguageB} disabled={listening || busy} />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button type="button" disabled={capture.phase === "finishing"} onClick={listening || pending ? capture.stop : () => void capture.start({ inputSource, translation })} className="min-h-11 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg hover:bg-accent disabled:opacity-50">
            {listening ? "실시간 번역 중지" : pending ? "연결 취소" : "실시간 번역 시작"}
          </button>
          {(capture.phase === "finished" || capture.phase === "error") && (
            <button type="button" onClick={capture.reset} className="min-h-11 rounded-full border border-line px-5 text-[14px] font-semibold text-accent">새 세션</button>
          )}
        </div>
        {capture.error && <p className="mt-4 text-[13px] text-error" role="alert">{capture.error}</p>}
        <p className="mt-4 text-[12px] leading-5 text-inkSoft">
          웹 버전은 번역 자막을 표시하지만 번역 음성을 회의 상대에게 자동으로 보내지는 않습니다.
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

function LanguageSelect({ label, value, onChange, disabled }: { label: string; value: string; onChange(value: string): void; disabled: boolean }) {
  return (
    <label className="space-y-2 text-[13px] font-semibold text-ink">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[14px] font-medium text-ink">
        {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
      </select>
    </label>
  );
}

function VoiceTypingTool() {
  const capture = useSonioxLiveCapture();
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [output, setOutput] = useState("");
  const [smartCleanup, setSmartCleanup] = useState(true);
  const modeRef = useRef<VoiceTypingShortcutMode>("dictation");
  const processedTranscriptRef = useRef<typeof capture.transcript | null>(null);
  const pending = capture.phase === "requesting" || capture.phase === "connecting";
  const listening = capture.phase === "listening";
  const busy = ["requesting", "connecting", "finishing"].includes(capture.phase);

  const begin = (mode: VoiceTypingShortcutMode) => {
    modeRef.current = mode;
    const translation: SonioxTranslationOptions = mode === "translation"
      ? { mode: "one_way", targetLanguage }
      : { mode: "none" };
    void capture.start({ inputSource: "microphone", translation });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mode = resolveVoiceTypingShortcut(event);
      if (!mode) return;
      event.preventDefault();
      if (capture.phase === "listening" || capture.phase === "requesting" || capture.phase === "connecting") capture.stop();
      else if (capture.phase !== "finishing") begin(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
            <h2 className="text-[18px] font-bold text-ink">Voice Typing 설정</h2>
            <p className="mt-1 text-[13px] leading-6 text-inkSoft">말한 내용을 실시간으로 받아쓰거나 선택한 언어로 번역해 편집기에 추가합니다.</p>
          </div>
          <StatusPill phase={capture.phase} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-soft/40 p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-[13px] font-semibold text-ink">일반 받아쓰기</span><kbd className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-[12px] text-ink">Fn</kbd></div>
            <p className="mt-2 text-[12px] leading-5 text-inkSoft">한 번 눌러 시작하고 다시 눌러 종료합니다. 웹 대체키는 F8입니다.</p>
          </div>
          <div className="rounded-xl border border-line bg-soft/40 p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-[13px] font-semibold text-ink">번역해서 입력</span><kbd className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-[12px] text-ink">Fn + Shift</kbd></div>
            <p className="mt-2 text-[12px] leading-5 text-inkSoft">선택한 언어로 번역합니다. 웹 대체키는 Shift+F8입니다.</p>
          </div>
        </div>

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
          <button type="button" disabled={!output} onClick={() => void navigator.clipboard?.writeText(output)} className="min-h-10 rounded-full border border-line px-4 text-[12px] font-semibold text-accent disabled:opacity-40">복사</button>
        </div>
        <textarea id="voice-typing-output" value={output} onChange={(event) => setOutput(event.target.value)} placeholder="받아쓰기 또는 번역 결과가 여기에 추가됩니다." className="mt-3 min-h-48 w-full resize-y rounded-xl border border-line bg-bg p-4 text-[15px] leading-7 text-ink" />
        {(capture.transcript.original.final || capture.transcript.original.provisional) && capture.phase !== "finished" && (
          <p className="mt-3 whitespace-pre-wrap text-[13px] text-inkSoft">{capture.transcript.original.final}{capture.transcript.original.provisional}</p>
        )}
      </section>

      <section className="rounded-2xl border border-warn/40 bg-warnBg p-5 text-[13px] leading-6 text-ink">
        <h3 className="font-bold">웹 단축키 범위</h3>
        <p className="mt-2 text-inkSoft">웹에서는 현재 탭에 포커스가 있을 때만 단축키를 감지할 수 있습니다. macOS가 Fn 이벤트를 브라우저에 전달하지 않을 수 있어 F8을 함께 지원합니다. 다른 앱의 커서 위치에 직접 삽입하는 전역 입력은 향후 데스크톱 앱에서 접근성 권한을 받은 뒤 지원합니다.</p>
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
    transcription: ["전사", "회의를 녹음하면서 Soniox 실시간 원문을 확인합니다."],
    translator: ["실시간 번역", "Zoom·Google Meet 웹 탭 또는 마이크 음성을 실시간 번역합니다."],
    "voice-typing": ["Voice Typing", "단축키로 받아쓰기와 번역 입력을 전환합니다."],
  } as const;
  const [title, description] = headings[selection.tool];

  return (
    <main id="main" className="w-full max-w-6xl space-y-7 px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-accent">Soniox Workspace</p>
        <p className="mt-2 text-[13px] font-medium text-inkSoft">{workspace?.name ?? "워크스페이스"} / {folder?.name ?? "폴더 없음"}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-[15px] leading-6 text-inkSoft">{description}</p>
      </header>
      {selection.tool === "transcription" && <TranscriptionTool workspaceId={selection.workspaceId} folderId={selection.folderId} />}
      {selection.tool === "translator" && <TranslatorTool />}
      {selection.tool === "voice-typing" && <VoiceTypingTool />}
    </main>
  );
}
