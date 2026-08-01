# Vision용 디자인 가이드 · 화면 인벤토리 · old→new 카피 매핑

> 정체성·권리 근거는 [vision-rebrand-identity.md](vision-rebrand-identity.md).
> vendor 중립 계약은 [ADR 0024](decisions/0024-external-provider-exception-and-vendor-neutral-ui.md).
> 배포 blocker는 [vision-rebrand-deployment.md](vision-rebrand-deployment.md).

## 0. 원칙

1. **로고 무권리 → 타이포 전용.** 공식 Vision/GLOBAL WiFi 로고 자산을 복제·임베드·변형하지 않는다. 헤더는 타이포그래피 전용 `Vision` 워드마크 fallback을 쓴다(권리 확보 전까지 공식 로고 acceptance 미충족, 날조 금지).
2. **팔레트·폰트 역산 금지.** first-party가 브랜드 컬러/폰트를 공개하지 않으므로, **기존에 테스트로 고정된 디자인 토큰 시스템을 그대로 유지**한다. Vision 도입은 워드마크·제품명 카피에 한정한다.
3. **vendor 중립 유지(ADR 0024).** 외부 provider 상호(Soniox/Soniworks/Codex/OpenAI)를 화면·상태칩·오류·URL에 노출하지 않는다. "Vision"은 **고객사(브랜드)**이지 외부 AI provider가 아니므로 노출은 계약 위반이 아니다.

## 1. 로고 사용 / fallback

- **워드마크:** 텍스트 `Vision`(그래픽 자산 없음). 컴포넌트 `BrandWordmark`(`src/components/LibraryNavigation.tsx`).
- **2행 lockup(헤더):**
  - 1행: `Vision` — `font-extrabold tracking-tight text-ink`, 16px(데스크톱 rail) / 15px(compact: 모바일 top-bar·drawer·fallback).
  - 2행(정확히): `AI 미팅 에이전트(AI Meeting Agent)` — `text-[11px] font-semibold text-inkSoft`, `truncate`.
- **제품명(정확히):** `Vision AI 미팅 에이전트` — `<title>`/metadata/문서 제목/홈 링크 접근성명 base.
- **홈 링크 접근성명:** `Vision AI 미팅 에이전트 홈`.
- **locale 불변:** 브랜드 블록은 `data-i18n-user-content`(텍스트)·`data-i18n-user-attributes`(aria-label)로 i18n MutationObserver에서 제외 → 모든 locale에서 동일 표기.
- **금지:** 공식 로고 PNG/SVG 삽입, 로고 트레이싱/모작, 지구+Wi-Fi 심볼 재현, TSE Prime 로고 사용.

## 2. 컬러 (기존 토큰 유지 — 변경 없음)

리브랜드로 팔레트를 바꾸지 않는다(§0-2). 사용 토큰(Tailwind, `globals.css`/config):

| 토큰 | 용도 |
|---|---|
| `bg` / `chrome` / `panel` / `soft` | 본문·크롬(사이드바)·카드·강조 배경 |
| `ink` / `inkSoft` / `inkFaint` | 본문·보조·경계 텍스트 |
| `accent` / `brand` | 인터랙션 강조·활성 인디케이터 |
| `line` | 경계선 |
| `success` / `warn` / `error` (+ `successBg`) | 상태 톤(시스템 상태칩) |

상태 톤 매핑은 `healthStatus.ts`의 `TONE_CLASS`(neutral/success/warn/error) 그대로.

## 3. 타이포그래피 / 간격 / 형태 / 아이콘

- **타이포:** 앱 `font-sans`(기존) 유지. Vision 폰트 미공개이므로 별도 폰트 미도입.
- **워드마크 스케일:** 위 §1. 2행 lockup의 line-height는 `leading-tight`.
- **간격:** 사이드바 시스템 섹션·행 간격 등 기존 spacing 스케일 유지. 최소 터치 타깃 44px(min-h-11) 유지.
- **형태:** rounded-lg/rounded-full 등 기존 radius 유지.
- **아이콘:** 인터랙티브 아이콘은 `InlineIcons.tsx` 공유 SVG만(기존 규칙). 브랜드 로고 아이콘 신규 도입 없음.

## 4. 레이아웃 / 상태·피드백 / 접근성 / 반응형

- **레이아웃:** 앱 셸(좌 `LibraryNavigation` rail 272px + 우 콘텐츠)·데스크톱/모바일(top-bar+drawer) 구조 유지. 헤더 워드마크만 2행 브랜드 블록으로 교체.
- **상태·피드백(시스템 상태 행):** ADR 0024의 `로컬`/`외부 모델` 2행을 **3행으로 분리** — `로컬`(전사) · `요약`(요약 모델, vendor 중립) · `실시간`(실시간 연결). 실시간 행의 연결 진실은 **실제 WebSocket 생명주기(연결 store)** 에서만 파생하고, 키 존재(configured)는 라이브 세션이 없을 때 `미설정 vs 대기`만 구분하는 보조 신호다. 라벨은 vendor 중립(`Soniox` 등 미노출).
- **접근성:** 홈 링크 접근성명 `Vision AI 미팅 에이전트 홈`(데스크톱·모바일 공통). 상태 행 `aria-live="polite"`, 라벨 변화시에만 갱신(기존). 브랜드 2행 중 색약 대비를 위해 텍스트는 `text-ink`/`text-inkSoft` 유지.
- **반응형:** 데스크톱 1440 / 모바일 390 / 최소 360에서 워드마크 2행이 truncate로 overflow 없이 수용. 뷰포트 회귀는 기존 Playwright 3-viewport fixture로 검증.

## 5. 토큰·컴포넌트 정리

- 신규 상수(컴포넌트-local, `LibraryNavigation.tsx`): `BRAND_PRODUCT_NAME`, `BRAND_TAGLINE`, `BRAND_HOME_LABEL`, `BrandWordmark`.
- `brandNameForLocale()`(`src/lib/appPreferences.ts`) → locale 불변 `"Vision"`.
- 상태 포맷터(`healthStatus.ts`): `formatSummaryModelStatus(llm)`, `formatRealtimeStatus(connection, capability)` 신규. 기존 `formatExternalStatus`(LLM+실시간 결합) 제거.
- 연결 store: `src/services/sonioxConnectionStore.ts` + hook `src/components/useSonioxConnection.ts`.

---

## 6. 사용자 화면 인벤토리 (전수) · old→new 카피 매핑

브랜드 문자열이 렌더되는 런타임 표면은 **3곳**뿐(인벤토리 조사 결과): 헤더 워드마크, 문서 title/metadata, 릴리즈 화면. 나머지 화면은 브랜드 카피를 렌더하지 않는다.

### 6.1 App Router 페이지 / 레이아웃

| 라우트 | 파일 | 브랜드 카피 | old → new |
|---|---|---|---|
| (앱 셸) | `src/app/layout.tsx` | metadata.title | `헤이홈 AI 기록도구` → **`Vision AI 미팅 에이전트`** |
| `/` | `src/app/page.tsx` | 없음(HomeClient) | — |
| `/live` | `src/app/live/page.tsx` | 없음 | — |
| `/glossary` | `src/app/glossary/page.tsx` | 없음 | — |
| `/settings` | `src/app/settings/page.tsx` | 없음 | — |
| `/settings/releases` | `src/app/settings/releases/page.tsx` | 없음(ReleaseNotes 렌더) | 아래 6.4 |
| `/meetings/[id]` | `src/app/meetings/[id]/page.tsx` | 없음 | — |
| 404 | `src/app/not-found.tsx` | 없음 | — |

`error.tsx`/`global-error.tsx`/`loading.tsx` 파일은 저장소에 없음. `not-found.tsx`가 유일한 error/recovery 라우트 파일이며 브랜드 카피 없음.

### 6.2 헤더/네비게이션 워드마크 (`src/components/LibraryNavigation.tsx`)

| 위치 | old(카피/aria) | new |
|---|---|---|
| 데스크톱 rail 홈 링크 | 텍스트 `헤이홈 AI 기록도구` / aria `헤이홈 AI 기록도구 홈` | `BrandWordmark`(2행) / aria `Vision AI 미팅 에이전트 홈` |
| 모바일 top-bar 홈 링크 | 동상 | `BrandWordmark compact` / aria `Vision AI 미팅 에이전트 홈` |
| 모바일 drawer 헤더 | 텍스트 `헤이홈 AI 기록도구` | `BrandWordmark compact` |
| fallback nav 홈 링크 | 텍스트+aria 동상 | `BrandWordmark compact` / aria `Vision AI 미팅 에이전트 홈` |

### 6.3 문서 title / metadata (client 유지)

| 위치 | old → new |
|---|---|
| `src/app/layout.tsx` static metadata.title | `헤이홈 AI 기록도구` → `Vision AI 미팅 에이전트` |
| `src/components/AppPreferences.tsx` 문서 title effect | `translateUi(locale,"헤이홈 AI 기록도구")` → 고정 `Vision AI 미팅 에이전트` |
| `AppPreferences` context `brandName` / `brandNameForLocale()` | `헤이홈`/`Soniox`/`Hejhome` → locale 불변 `Vision` |

metadata description(`회의 녹음, 실시간 전사·번역, 회의록 요약`)은 브랜드가 아니므로 유지(계속 번역).

### 6.4 다이얼로그 / 드로어 / 오버레이 / recovery

`AppDialog`/`AppDrawer`·`SearchOverlay`·`ContainerDeleteDialog`·`LibraryLocationPicker`·`LibraryRecoveryPanel`·`MeetingDetailView` 편집 다이얼로그·`RecorderSessionProvider` 네비게이션 가드·`ChatPanel`(dormant)·`TestProductMeetingPanel` — **브랜드 카피 없음 → 변경 없음**(내부 `Soniox` 코드 식별자만 존재, ADR 0024가 명시적으로 계약 대상에서 제외).

### 6.5 릴리즈 화면 (open-source lineage 예외)

| 위치 | 문자열 | 처리 |
|---|---|---|
| `src/components/ReleaseNotes.tsx:19` | `최초 AI NOTE 오픈소스를 1.0.0으로 두고…` | **정당한 open-source lineage 예외로 유지·문서화.** `AI NOTE`는 이 제품의 오픈소스 기반 프로젝트명(과거 사실)이며, 릴리즈 노트는 그 계보를 설명한다. 제품 UI의 현재 브랜드는 헤더/제목에서 Vision으로 대체됨. |
| `RELEASES.md`(과거 항목: `AI NOTE 오픈소스 기준판` 등) | 릴리즈 화면에 렌더되는 과거 릴리즈 제목/불릿 | **동일 예외로 유지.** 과거 릴리즈의 사실적 제목을 소급 개작하지 않는다(내구 이력). ADR: "supplier/open-source/legal names may remain only where necessary and must be documented." |

> **결정 근거:** 태스크는 "legacy 고객 대상 제품명을 모든 화면에서 대체"하되 "open-source/legal 이름은 필요한 곳에서만 유지·문서화"를 허용한다. 릴리즈 화면의 `AI NOTE`는 (a) 현재 제품명이 아니라 과거 오픈소스 프로젝트명이고 (b) 이력 서술에 필요하므로 예외로 남긴다. 현재 활성 브랜드 표면(헤더·제목)은 전부 Vision으로 대체 완료.

### 6.6 supplier/legal 예외 요약

| 이름 | 위치 | 유지 사유 |
|---|---|---|
| `AI NOTE` | ReleaseNotes/RELEASES.md 이력 | open-source lineage(과거 프로젝트명) |
| `Whisper`/`Ollama`/`Claude`/`Codex` | 설정 화면 provider 선택·health | 운영자 대상 설정 표면. 사이드바 시스템 행은 vendor 중립 유지(ADR 0024). |
| `ai-note`(npm/repo/스토리지 키/HTTP 헤더/테스트 fixture id) | 내부 식별자 | 마이그레이션 위험·계약 대상 아님(ADR 0024) → 미변경 |
| i18n 카탈로그의 `헤이홈`→`Soniox`/`Hejhome` 매핑 | `src/lib/i18n*` | 워드마크가 더 이상 이 키를 렌더하지 않아 **dead** 상태. 엄격한 i18n coverage 테스트 보존을 위해 데이터는 그대로 두되, 실제 화면 노출은 없음(문서화된 잔여). |

## 7. 잔여 리스크

- 공식 Vision 로고 미사용(권리 없음) → 헤더는 타이포 fallback. 공식 로고 acceptance 미충족(§identity §4).
- i18n 카탈로그에 legacy 브랜드 매핑이 dead 상태로 잔존(무노출). 후속으로 키 정리 가능하나 coverage 테스트 동시 갱신 필요.
- 릴리즈 화면의 `AI NOTE`는 의도적 lineage 예외.
