# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Product version ledger

제품 소유자가 지정한 기준에 따라 최초 AI NOTE 오픈소스를 제품 버전 `1.0`으로 정규화합니다. 이후 문서·병합·테스트 전용 커밋이 아니라 사용자에게 전달되는 기능 묶음마다 버전을 올립니다. 현재 제품 버전은 `1.15.2`입니다.

- **1.15.2 (2026-07-29) — Push-to-Talk 경계·TTS 선연결 안정화**: 수동 `<fin>` 경계 식별, final-only 번역 송출, 같은 화자의 Space 이후 발화 차단, 준비된 TTS 세션 갱신.
- **1.15.1 (2026-07-29) — 실시간 번역·Push-to-Talk 지연 개선**: Soniox 양방향 provisional 번역 표시, 두 번째 Space 수동 finalization, 준비된 번역의 LLM 우회, TTS WebSocket 선연결.
- **1.15 (2026-07-29) — 자유 참여 글로벌 미팅 테스트 프로덕트**: 참석자 수·그룹·사전 등록 없는 자동 화자 구분, 외국어 원문·한국어 번역 병렬 기록, 대상 언어 설정, 스페이스바 Push-to-Talk 텍스트·음성 송출.
- **1.14 (2026-07-29) — 단방향 트랜스레이터와 실시간 글로벌 미팅**: 두 최상위 번역 모드, 참석자별 세션 화자 등록, 가변 그룹·언어 라우팅, 양측 번역 창과 FIFO 음성 재생, 제품 버전·Markdown 릴리즈 노트.
- **1.13 (2026-07-29) — 언어별 화자 동시 통역**: 한국어·영어 참석 인원 설정, 화자별 세션 등록과 확인, 양쪽 언어의 완결 번역을 순차 스피커 재생, 에코 제거·울림 대응 안내.
- **1.12 (2026-07-28) — 설정·회의·화자 통역 완성도**: 데스크톱 독립 스크롤, 단계별 글자 크기, 명시적 회의록 삭제, 세션 화자 프로필과 등록 확인, 우리 팀 최종 번역 TTS, 상대 팀 번역 자막, 설정 하단 릴리즈 노트.
- **1.11 (2026-07-28) — 헤이홈 경험 안정화**: 홈 빠른 시작, TTS 안정화, Voice Typing 초안 복구, 접근성·테마·다국어 품질 보강.
- **1.10 (2026-07-28) — 헤이홈 Soniox 워크스페이스**: 제품 브랜딩·디자인 시스템, Soniox 중심 작업 공간, 4개 언어와 테마.
- **1.9 (2026-07-27) — Soniox 실시간 도구**: 실시간 Voice Typing·Translator와 Soniox TTS.
- **1.8 (2026-07-25) — 설치와 첫 실행**: 원클릭 설치·관리형 런타임, 최초 실행 가이드, LLM 모델 선택·상태 표시.
- **1.7 (2026-07-23) — 인라인 편집**: 전사·요약 편집 동선과 보존 상태 표시.
- **1.6 (2026-07-15) — 수동 콘텐츠 편집**: Markdown 기반 회의 전사·요약 편집과 재요약 흐름.
- **1.5 (2026-07-14) — 근거 중심 탐색**: 인용 기반 답변, 탐색 경계 강화, 사이드바 검색·내비게이션 개선.
- **1.4 (2026-07-12) — 검색과 AI 대화**: 회의 검색, 색인, AI 챗봇, 대화 UI.
- **1.3 (2026-07-11) — 라이브러리와 반응형 UI**: 워크스페이스·폴더 구조, 보존 중심 이동·삭제, 모바일·접근성 개선.
- **1.2 (2026-07-10) — 회의 관리 기능**: 제목 변경, 회의 삭제, 용어집, 개별 재요약, 상태·오류 처리 개선.
- **1.1 (2026-07-08) — 로컬 요약 파이프라인**: 로컬 Whisper 전사, Claude·Codex·Ollama 요약, 백그라운드 처리와 내보내기.
- **1.0 (2026-07-08) — AI NOTE 오픈소스 기준판**: 로컬 우선 녹음·전사·요약의 최초 공개 기준.

> `0.1.0`은 원본 공개 당시의 패키지 태그이며, 위 제품 버전 이력에서는 소유자 지정 기준에 따라 `1.0`으로 대응합니다.

## [Unreleased]

### Added

- **One-command installation and owned background runtime**: a dependency-free
  `node scripts/bootstrap.mjs --launch` flow now runs the prerequisite doctor,
  installs exact npm dependencies with hooks disabled, builds, chooses bounded
  free loopback ports, starts app and Whisper under a repository-owned
  supervisor, waits for both health checks, and opens or prints the actual app
  URL. Ownership-checked `app:start`, `app:status`, and `app:stop` commands do
  not attach to or signal unrelated or unverifiable processes.
- **First-use summary readiness and provider-aware model selection**: the home
  screen offers non-blocking summary setup or recorder focus, Settings puts the
  summary model before optional profile information, and a successful save
  automatically checks persisted health. Claude exposes default/Sonnet/Opus/
  Haiku/custom choices, Codex exposes default/custom, and Ollama discovers only
  locally installed models with refresh and custom-input fallback.
- **Local workspace/folder library**: a 272px desktop rail and accessible mobile
  drawer now switch between workspace All, Unfiled, and direct folder pages.
  Users can create/rename workspaces and create/edit folders up to three levels
  with semantic colors. Meeting files keep stable paths; organization is stored
  in the central `library.json` registry.
- **Bounded, recoverable library navigation**: canonical scope URLs, cursor
  next/previous pages, source-safe detail back links, global summary-attention
  navigation, and a separate "organization pending" section keep meetings
  discoverable without building an unbounded client list.
- **Read-only degraded library views**: a last-good tree or bounded global
  fallback remains available when registry data is corrupt, from a newer app
  version, or temporarily unreadable. Retry and fixed data-folder reveal are
  available; mutations stay disabled while recording can retain the last-known
  destination as an explicit, read-only hint.
- **Scoped, interruption-safe recording**: recording is available from every
  ready/last-good library scope and snapshots canonical destination IDs at
  start. Lost finalize responses are recovered with a same-ID bodyless probe;
  the retained Blob is resent only after the server confirms no publication.
  Result cards separate artifact durability, actual/fallback placement,
  playback preparation, and transcription recovery.
- **Metadata-only meeting and folder moves**: meetings can move within or across
  workspaces while their artifact directory and immutable bytes stay fixed.
  Folder subtrees can move within one workspace with cycle, depth, sibling-name,
  revision, and stale-destination checks. Shared pickers preserve safe detail
  context and clear stale selections instead of silently falling back.
- **Preservation-first container deletion**: folder/workspace previews separate
  visible meetings, affected and hidden placements, children, and pending
  finalize intents. Folder deletion rehomes meetings and promotes children;
  workspace deletion moves all meetings to a chosen destination Unfiled and
  atomically updates the default. Meeting artifact files are never deleted.
- **Crash-safe corrupt-library recovery**: corrupt registry views can explicitly
  rebuild from a fingerprint-guarded dialog after preserving the original in a
  private local archive. Restart planning, atomic intent phases, required
  namespace durability, recorder Blob gating, and full client generation reset
  prevent unsupported states or late old-generation responses from overwriting
  organization data.

- **Meeting title editing**: rename a summarized meeting from the list (kebab
  menu → 이름 수정). The manual title is stored as `titleOverride` in
  `status.json`, so it survives re-summarize and every re-derive.
- **Meeting deletion**: permanently delete a meeting folder from the list (kebab
  menu → 삭제) with an inline confirm. Refused while a summarize is in progress.
- **Glossary management**: a **단어 관리** tab to edit domain terms and
  "misheard → correct" pairs (`{ terms, corrections }`), applied by the LLM
  correction step. A legacy string-array `glossary.json` is still read as `terms`.
- **Left navigation rail**: a persistent library rail (desktop) and accessible
  mobile drawer expose workspace switching, meetings/glossary/settings links, and
  whisper/AI health status rows, plus a skip-to-content link.
- **Manual single-meeting re-summarize**: a "다시 요약" button on a summarized
  meeting regenerates just that one (applies glossary changes to existing
  meetings). No auto/bulk re-summarize — the background worker never re-runs a
  summarized meeting.

### Changed

- End-user installation now uses the dynamic URL printed by the background
  bootstrap instead of assuming `localhost:3000`; foreground `npm run dev` is
  documented as a contributor command. First-transcription copy now explains
  the selected Whisper model download without showing invented progress.
- Completed meetings with a usable summary now open the summary tab by default
  unless the script tab is explicitly requested. Recorder and first-use copy
  consistently explain that recording and local transcription work without a
  configured summary model.
- **App-wide UI/UX hardening**: modal dialogs and the mobile drawer now use the
  browser's native top layer, so focus stays contained, background content is
  inert, Escape/backdrop only dismiss the topmost surface, and a busy mutation
  can't be dismissed out from under you. The meeting list, editors, forms,
  banners, and the detail toolbar reflow cleanly from 320px up without horizontal
  scrolling, and the meeting detail follows a fixed order (title → status/location
  → notices → actions → audio/participants → tabs). Glossary and Settings now
  distinguish "loading", "ready", and "failed to load" instead of showing an
  empty form on a failed read, and only offer save/replace once current values
  are known. Audio playback supports HTTP Range requests, so seeking and
  re-seeking a long recording streams just the requested bytes and cancels
  cleanly on reload/navigation.
- **Correction step** now normalizes numbers/dates/times/amounts to Arabic
  numerals (values unchanged) and applies glossary `corrections`.
- **Glossary format**: `glossary.json` is now a `{ terms, corrections }` object
  (was a flat string array); the array form is auto-migrated on read.

### Fixed

- **Persistent transcription failure and real retry**: list rows, meeting
  detail, and recorder save results retain a visible transcription-failure
  state. Retry posts the exact meeting ID to the existing durable
  `/api/transcribe` route, prevents duplicate in-flight polling, refreshes
  server state after accepted/already-running races, preserves safe error copy,
  and returns focus to the retry control.
- **Re-summarize reliability** (ADR 0009):
  - **Timeout**: LLM correction/summary calls now use a fixed 10-minute timeout
    (`LLM_GENERATION_TIMEOUT_MS`) instead of the 120s subprocess default — a long
    meeting's correction step re-emits the whole transcript and was being SIGKILLed.
  - **Async**: "다시 요약" no longer blocks the request for minutes. The route
    validates synchronously, fires the summarize in the background, and returns
    `202`; the detail view polls for the new summary.
  - **Failure visibility**: a failed re-summarize keeps the prior summary and the
    `summarized` state (instead of demoting to `transcribed`) and surfaces a
    "재요약 실패" banner with retry; `deriveStatus` preserves the `retry_summary`
    error on promotion so the GET route no longer silently erases it.
- **Honest LLM health & status** (claude):
  - **No false "실패 — check login"**: the sidebar claude health check now does a
    lightweight `claude --version` detection (labelled "감지됨", like codex) instead
    of a 25s `claude -p` probe a cold start could trip — auth is confirmed on the
    first real summary. The catch-all that reported every error as "check login" is
    gone.
  - **Error reason surfaced**: `exec` now includes the process's stdout tail in the
    failure error when stderr is empty, so a summary failure shows claude's actual
    reason (e.g. "Not logged in · Please run /login") instead of a blank exit code.
  - **No false-green backlog**: the home banner splits "요약 자동 처리 중 N" from
    "확인 필요 M" (transcribed meetings whose auto-summary failed and the worker
    backed off), so an exhausted meeting is no longer shown as forever
    "auto-processing".
  - **Poller hygiene**: the shared health poller dedups in-flight fetches per
    endpoint so a slow check can't stack across poll ticks.
- **Isolated claude summarize invocation** (ADR 0010):
  - **No context pollution**: claude summary calls now run in an isolated temp
    cwd (`os.tmpdir()`) with MCP + slash commands off, so the project's
    workspace `CLAUDE.md`/MCP context no longer leaks into the corrected
    transcript (a past pollution bug). The prompt and summary schema are
    unchanged.
  - **$0 guard**: paid-billing env vars — credentials (`ANTHROPIC_API_KEY`,
    `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`) and backend redirects
    (`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`) — are scrubbed from
    the child environment so a subscription-OAuth CLI is never silently metered to
    a paid API; `HOME`/`PATH` (OAuth keychain + binary lookup) are kept.

## [0.1.0] - 2026-07-08

Initial public release. AI NOTE is a local-first meeting recorder: everything
runs on `127.0.0.1`, with no accounts, no stored API keys, and no telemetry.

### Added

- **Record → transcribe → summarize** pipeline, fully local: capture audio in
  the browser, transcribe with a local Whisper service, then summarize.
- **Bring-your-own summarizer**: summaries are generated by your own local
  Claude CLI, Codex CLI, or an Ollama model — no API keys stored.
- **Background auto-summary worker**: transcription and summarization continue
  even if you close the tab, producing a corrected transcript (`transcript.md`)
  and a structured summary (`summary.json`).
- **Export**: copy, download, or reveal the meeting folder to take your summary
  anywhere.
- **Whisper backends**: `mlx-whisper` on Apple Silicon, with a
  `faster-whisper` CPU fallback on Linux / Windows / Intel Mac.
- **Configuration** via `.env.local` (Whisper model, decode language, service
  host/port, ffmpeg path) and a domain-term `glossary.json`.
- Korean UI (v0.1); internationalization is on the roadmap.

[Unreleased]: https://github.com/mimpp92-dotco/ai-note/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mimpp92-dotco/ai-note/releases/tag/v0.1.0