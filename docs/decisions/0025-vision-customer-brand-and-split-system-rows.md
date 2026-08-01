# 0025 — Vision 고객사 브랜드와 분리된 시스템 상태 행 (0024의 사이드바 2행 규정 부분 대체)

- **날짜:** 2026-08-01
- **상태:** 채택됨

## 무엇을 결정했나

**(1) 고객사 브랜드 = Vision.** 제품 표면의 이름을 `Vision AI 미팅 에이전트`, 워드마크를 `Vision`, 부제를 `AI 미팅 에이전트(AI Meeting Agent)`로 확정한다. 브랜드 문자열은 **로케일 불변**이며 i18n 카탈로그를 타지 않는다. 단일 소스는 `src/lib/brand.ts` 하나이고, 렌더 표면은 `data-i18n-user-content`로 i18n MutationObserver에서 제외한다(이 속성은 텍스트와 `aria-label`/`title` 속성 양쪽을 함께 제외한다). 워드마크는 **타이포그래피 전용**이며 공식 로고 자산을 임베드·복제·변형하지 않는다.

Vision(株式会社ビジョン)은 **고객사**이지 외부 AI provider가 아니므로, 이름 노출은 ADR 0024의 vendor 중립 계약 위반이 아니다. 0024가 가리는 대상은 실시간 STT/번역·요약 API의 **provider 상호**다.

**(2) 사이드바 시스템 상태를 3행으로 분리한다 — `로컬` · `요약` · `실시간`.** 이는 **0024의 "`로컬`과 `외부 모델` 두 행" 규정을 대체**한다(0024의 나머지 vendor 중립 계약은 그대로 유효하다). 각 행은 여전히 provider·모델명을 노출하지 않는다.

**(3) `실시간` 행의 연결 진실은 실제 WebSocket 생명주기에서만 파생한다.** `src/services/sonioxConnectionStore.ts`가 `connectSonioxRealtime`이 발행하는 이벤트만으로 상태를 만든다. `connected`의 유일한 경계는 **소켓 open + config 프레임 전송 성공**이고, close/error/abort/provider terminal 응답은 `disconnected`다. 설정 키 존재(`/api/health`의 config-presence 폴링)는 **라이브 세션이 없을 때 `미설정` vs `대기`를 가르는 보조 capability 신호**일 뿐 연결 근거가 아니다.

Store는 시도마다 monotonic session을 발급하고 이벤트에 `(session, sequence)`를 실어 중복·역순·지연된 옛 세션 이벤트를 억제한다. **최신 세션이 권위를 갖는다(last attempt wins)** — 동시 다중 연결을 합산하지 않는다. `reset()`은 카운터를 되감지 않고 **outstanding publisher를 fence**한다(되감으면 reset 이전 publisher의 다음 이벤트가 새 세션으로 오인되어 방금 지운 상태를 되살린다).

## 왜

**브랜드.** 데모는 고객사 화면으로 보여야 하는데, 이전 이름은 로케일별로 3종(`헤이홈`/`Soniox`/`Hejhome`)이었다. 그중 `Soniox`는 **provider 상호가 제품명 자리에 노출된 상태**로 0024를 정면으로 위반하고 있었다. 제품명을 번역 대상으로 둔 설계 자체가 원인이므로, 브랜드를 UI 카피에서 분리해 로케일 불변 상수로 못박았다. 로고를 쓰지 않는 이유는 1차 출처 조사 결과 **제3자 로고 사용을 허가하는 근거가 없고 고객사가 등록상표·전 IP를 유보**하기 때문이다 — 근거와 잔여 리스크는 [vision-rebrand-identity.md](../vision-rebrand-identity.md) §4에 기록했다. 공식 팔레트·폰트도 미공개라 디자인 토큰을 로고에서 역산하지 않고 기존 디자인 시스템을 유지한다([vision-rebrand-design-and-inventory.md](../vision-rebrand-design-and-inventory.md)).

**행 분리와 이벤트 기반 연결.** 0024의 단일 `외부 모델` 행은 요약 모델과 실시간 키를 AND로 묶어, 실시간만 살아 있어도 `준비 안됨`으로 보이고 어느 쪽이 문제인지 알 수 없었다. 더 나쁜 것은 그 행이 **설정 존재 여부만 보고 `준비됨`을 칠했다**는 점이다 — 키가 있으면 연결이 끊겨도 초록이었다. 실시간 세션은 미팅 중 실제로 끊긴다(네트워크, provider 오류, 토큰 만료). 연결 상태는 폴링으로 알 수 없고 오직 소켓 생명주기가 안다. 그래서 `연결됨`의 근거를 config-presence에서 떼어내 실제 이벤트로 옮겼고, "설정됐지만 아직 세션 없음"을 초록이 아닌 중립 `대기`로 분리했다.

`(session, sequence)` 억제가 필요한 이유는 재연결 때문이다. 옛 세션의 지연된 close가 새 세션의 `연결됨`을 덮으면, 사용자는 멀쩡히 자막이 흐르는 화면에서 끊김 표시를 본다. Last-attempt-wins를 고른 것은 앱이 실제로 구동하는 생명주기(시작 → 실패 → 재연결)가 순차적이기 때문이다. 동시 캡처가 겹치면 새 세션의 종료가 아직 살아 있는 옛 세션을 끊긴 것으로 표시하지만, 영향은 **사이드바 표시 한 줄에 국한**되고 캡처·오디오·전사에는 미치지 않는다. 동시 캡처가 지원 상태가 되면 그때 live session set 집계로 바꾼다.

## 버린 대안

- **제품명을 i18n 카탈로그에 로케일별로 유지** — 애초에 `Soniox`가 제품명 자리에 오게 만든 구조이고, 브랜드는 번역 대상이 아니다. 기각.
- **공식 Vision/GLOBAL WiFi 로고 임베드 또는 트레이싱** — 서면 라이선스 없이 상표·저작권 침해 리스크. 기각. 타이포 워드마크가 공식 로고 수용 기준을 완전히 충족하지 않는다는 점은 숨기지 않고 identity 문서에 명시했다.
- **브랜드 상수를 `LibraryNavigation.tsx`에 두기** — 최초 구현이 그랬으나 `layout.tsx` metadata도 같은 문자열이 필요해 4곳에 중복됐다. 네비게이션 컴포넌트는 브랜드 아이덴티티의 소유자가 아니다(`src/CLAUDE.md` 배치 규칙). `src/lib/brand.ts` + `src/components/BrandWordmark.tsx`로 분리.
- **`실시간` 행을 기존 health 폴러(`useHealth`)에 얹기** — 폴러는 config-presence만 알고 주기가 있어 끊김을 늦게·틀리게 보고한다. 연결은 이벤트지 폴링 대상이 아니다. 기각.
- **연결 상태를 recorder/capture 컴포넌트 local state로 두기** — 사이드바는 앱 셸에 있어 recorder 트리 밖이고, 클라이언트 네비게이션을 넘어 살아남아야 한다. health store처럼 앱 전역 external store를 택했다.
- **동시 세션 집계(live session set)** — 겹치는 캡처는 현재 지원 상태가 아니고, 집계는 세션 수명 추적·정리 부담을 더한다. 영향이 표시 한 줄이라 monotonic last-wins를 유지하고 한계를 store 주석과 여기에 명시하는 쪽을 골랐다.

## 영향받는 곳

- `src/lib/brand.ts`(단일 소스) · `src/components/BrandWordmark.tsx` · `src/app/layout.tsx`(metadata) · `src/components/AppPreferences.tsx`(`brandName`, document.title 유지)
- `src/services/sonioxConnectionStore.ts` · `src/components/useSonioxConnection.ts` · `src/services/sonioxRealtime.ts`(lifecycle 발행)
- `src/components/healthStatus.ts`(`formatSummaryModelStatus`/`formatRealtimeStatus` — `formatExternalStatus` 대체) · `src/components/LibraryNavigation.tsx`(`SystemRows`)
- i18n 카탈로그 `src/lib/i18n/catalogs/{en,ja,zh}.json`(새 행 문구 — 브랜드 문자열은 제외)
- 회귀: `src/lib/__tests__/brand.test.ts` · `src/services/__tests__/sonioxConnectionStore.test.ts` · `src/services/__tests__/sonioxRealtimeConnection.test.ts` · `src/components/__tests__/{healthStatus,LibraryNavigation,AppPreferences,useSonioxConnection}.test.*` · `e2e/{smoke,theme-i18n,global-meeting-translation}.spec.ts`
- 근거 문서: [vision-rebrand-identity.md](../vision-rebrand-identity.md) · [vision-rebrand-design-and-inventory.md](../vision-rebrand-design-and-inventory.md) · [vision-rebrand-deployment.md](../vision-rebrand-deployment.md)
