# 공유 통역 회의실 — 화면 흐름과 구현 계획

결정: [ADR 0028](../../decisions/0028-shared-interpreter-room.md). 이 문서는 화면 순서, API 계약, 데이터 파일, 단계별 구현과 검증 기준을 적는다. 문구는 최종 카피가 아니라 의도이며 ja/en/ko 카탈로그 등록 시 다듬는다.

## 1. 역할과 용어

| 용어 | 뜻 |
|---|---|
| 호스트 | 로그인한 고객 계정. 회의실을 만들고 초대하며 종료한다. 회의는 호스트 회의 목록에 남는다. |
| 게스트 | 링크+비밀번호+이름으로 들어온 외부 참가자. 계정 없음. 회의실 하나에만 접근. |
| 모드 | `remote`(화상회의, 각자 마이크) / `same_room`(같은 방, 호스트 마이크 하나) |
| 내 언어 | 참가자가 입장 시 고른 언어. 화면의 번역 방향과 귀속 규칙의 기준. |
| 발화(utterance) | Soniox endpoint로 확정된 한 덩어리. `speaker`, `sourceLanguage`, `original`, `translations{lang}` 를 가진다. |

## 2. 화면 흐름

### 2.1 호스트

1. **회의 목록 → `통역 회의실 만들기`** (녹음 CTA 옆 보조 action, 같은 rectangular group).
2. **만들기 dialog**: 제목(선택), 모드(`화상회의` 기본 / `같은 방`), 내 언어, 상대 언어(기본값, 게스트가 바꿀 수 있음). `만들기` → 회의실 생성, 상세로 이동.
3. **회의실 화면 상단**: 제목 · 모드 chip · 참가자 2칸(나 / 상대: 이름·언어·연결 상태) · `초대하기` · `회의 종료`.
   - `초대하기`는 클립보드에 아래 세 줄을 복사하고 `초대 내용을 복사했습니다`를 polite로 알린다.
     ```
     https://<origin>/join/<token>
     비밀번호: <8자 대소문자·숫자>
     회의가 끝난 뒤 24시간 동안 열립니다.
     ```
   - 비밀번호는 `비밀번호 보기`로 다시 볼 수 있고 `새 비밀번호`는 확인 뒤 재생성(기존 게스트 세션 폐기).
4. **대화 영역**: 단일 열 목록, 발화마다 다음 구조.
   - 내 발화: 왼쪽 내 이름 chip → 내 원문 → 아래 작은 label `상대에게 이렇게 전달됨` + 상대 언어 번역. 번역이 아직이면 `번역 중…`.
   - 상대 발화: 상대 이름 chip → 내 언어 번역(본문 크기) → `원문 보기` disclosure(기본 닫힘).
   - `same_room` 모드에서는 발화 오른쪽에 `내 말 / 상대 말` 정정 토글이 있고, 정정하면 양쪽 화면이 즉시 갱신된다.
5. **입력**: `remote`는 `말하기`(Push-to-Talk, 기존 왼쪽 Shift 단축키 유지)와 `자동 감지 켜기`(끊김 없이 계속 전사) 중 선택. `same_room`은 호스트만 마이크를 켜고 게스트 화면에는 입력 컨트롤이 없다.
6. **회의 종료**: 확인 dialog → 종료 시각 기록 → 대화록·회의록 발행(기존 글로벌 미팅 저장과 같은 pair 발행) → 호스트는 상세(2탭)로, 게스트 화면은 `회의가 끝났습니다 · 24시간 안에 내려받을 수 있습니다` + 다운로드 버튼.

### 2.2 게스트

1. `/join/<token>` 진입. 만료·존재하지 않음은 같은 화면(`이 링크는 더 이상 열 수 없습니다`)으로 구분하지 않는다.
2. **입장 폼**: 이름(1–40자) · 비밀번호 · 내 언어(ja→en→ko→zh 순서) → `입장`. 실패 5회/10분이면 잠시 잠근다(회의실 단위).
3. 입장 후 화면은 호스트와 같은 대화 영역이지만 라이브러리 rail·설정·검색이 없는 **최소 셸**이다. 상단에 `상대에게 초대받은 회의실` 안내와 자기 이름·언어, `언어 바꾸기`.
4. 종료 뒤 재접속: 같은 링크+비밀번호로 들어와 `대화록 내려받기(.md)`·`회의록 내려받기(.md)`. 회의록은 내려받기 전에 **언어 선택**(ja→en→ko→zh, 기본은 내 언어)이 있고, 호스트 언어가 아닌 언어는 `번역 준비 중…` 뒤 파일이 내려온다. 만료 후에는 1번 화면.

### 2.3 반응형·접근성

- 320/390/1440에서 발화 행은 세로 stack, 정정 토글은 44px, 번역 대기 상태는 `aria-live="polite"` 한 곳에서만 알린다.
- 참가자 연결 상태는 SSE 연결 이벤트에서만 파생한다(ADR 0025의 실시간 행과 같은 원칙). 상대 기기가 끊기면 `상대 연결 끊김`을 chip에 표시하고 대화는 유지한다.

## 3. 데이터 파일 (호스트 테넌트 · `meetings/{id}/`)

| 파일 | writer | 내용 |
|---|---|---|
| `status.json` | app-api | 기존 FSM. `kind:"interpreter_room"` 표시 필드 추가(표시용, FSM 불변) |
| `room.json` | room store | `{schemaVersion:1, mode, createdAt, endedAt|null, guestExpiresAt|null, invite:{tokenHash, passwordHash, rotatedAt}, participants:[{role:"host"|"guest", name, language, speakerLabel|null}], rateLimit:{failures, lockedUntil}}` |
| `room-events.jsonl` | room store | 한 줄 하나의 이벤트. `{seq, at, type:"utterance"|"translation"|"attribution"|"participant"|"ended", …}`. append는 temp가 아니라 `O_APPEND` + fsync이며 `seq`가 단조 증가. 손상 줄은 fail-closed(그 줄 이후를 읽지 않음). |
| `transcript.md`·`summary.json` | summarizePublisher | 종료 시 발행. 이벤트 로그가 정본, pair는 파생. |
| `summary.{lang}.md` | room store | 게스트가 고른 언어의 회의록 번역 캐시(요청 시 생성, 재생성 가능). 원본 요약은 불변. |

게스트 세션은 `room.json`에 두지 않고 `data/system/guest-sessions.json`(전역, app-api 단일 writer, `{tokenHash, meetingId, hostAccountId, name, language, expiresAt}`)에 둔다. 만료·회의 삭제 시 sweep이 지운다. 이유: middleware가 테넌트를 알기 전에 쿠키만으로 회의실과 호스트를 찾아야 하기 때문.

## 4. API 계약 (모두 Node · `no-store` · guard 우선)

| Route | 인증 | 계약 |
|---|---|---|
| `POST /api/rooms` | 호스트 | `{title?, mode, hostLanguage, guestLanguage}` → `{id, invite:{url, password, expiresPolicy}}`. 비밀번호 평문은 이 응답과 `POST /api/rooms/{id}/invite/rotate` 응답에만 존재 |
| `GET /api/rooms/{id}` | 호스트·게스트(해당 방) | 회의실 메타 + 참가자(비밀번호 해시 제외) |
| `POST /api/rooms/{id}/invite/rotate` | 호스트 | 새 비밀번호 발급, 게스트 세션 폐기 |
| `POST /api/rooms/join/{token}` | public | `{name, password, language}` → 게스트 쿠키 발급 + `{id}`. 실패는 401 단일 응답, rate limit 429 |
| `GET /api/rooms/{id}/events` | 호스트·게스트 | SSE. `Last-Event-ID` 이후 재전송. 15초 heartbeat |
| `POST /api/rooms/{id}/utterances` | 호스트·게스트 | `{clientId, original, sourceLanguage, speakerLabel?, endpointAt}` → 서버가 `speaker` 귀속 확정, 번역 큐 → 이벤트 broadcast |
| `PATCH /api/rooms/{id}/utterances/{seq}/speaker` | 호스트·게스트 | `{speaker:"host"|"guest"}` 수동 정정(`same_room`만) |
| `POST /api/rooms/{id}/end` | 호스트 | 종료·발행. 202 + durability |
| `GET /api/rooms/{id}/export?kind=transcript|minutes&language=ko|en|ja|zh` | 호스트·게스트(만료 전) | Markdown. 대화록은 요청자 관점, 회의록은 `language`로 번역(호스트 언어면 원본 그대로). 번역 사용량은 호스트 계정 집계 |
| `POST /api/realtime/temporary-key` | 기존 + 게스트 세션 허용 | 사용량은 호스트 계정에 집계 |
| `POST /api/translate` | 기존 + 게스트 세션 허용 | 동일 |

`accountAccessPolicy`: `/join/*`, `/api/rooms/join/*`는 public. `/api/rooms/{id}/**`와 `/join/*` 이후 화면은 게스트 쿠키 또는 고객 쿠키 중 하나로 통과하며, 게스트는 `meetingId`가 쿠키의 회의실과 다르면 404.

## 5. 화자 귀속 규칙 (`src/domain/room.ts`, pure)

```
attribute(utterance, room, previous):
  if room.mode == "remote": return utterance.origin            # 어느 참가자 기기에서 왔나
  langOwner = participants.filter(p => p.language == utterance.sourceLanguage)
  if langOwner.length == 1: return langOwner[0].role            # 1) 언어 규칙
  if utterance.speakerLabel and registered[label]: return it     # 3) 등록 문장
  if previous and previous.speakerLabel == utterance.speakerLabel: return previous.speaker  # 2) 연속성
  return { role: previousOrHost, confidence: "low" }             # UI가 정정 토글을 강조
```

낮은 신뢰도 발화는 chip을 점선으로 그리고 `누가 말했는지 확인해 주세요`를 한 번만 안내한다.

## 6. 단계와 검증 기준

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| 0 | ADR·이 문서·PRD 15항·ARCHITECTURE 회의실 절 | check:links 통과, 소유자 확인 |
| 1 | `domain/room.ts` 스키마·귀속 규칙, `roomStore`(room.json, jsonl append, sweep), `guestSession`(쿠키·토큰·비밀번호·rate limit), access policy | 단위 테스트: 손상 줄 fail-closed, 만료 계산(종료+24h, 미종료 72h), 회전 시 세션 폐기, 다른 회의실 ID 404 |
| 2 | `POST /api/rooms`, join, invite rotate, `GET /api/rooms/{id}`, middleware 분기 | route 통합 테스트: 게스트가 호스트 테넌트 밖을 못 읽음, 헤더 위조 무시, enumeration-safe 401 |
| 3 | SSE 이벤트, utterances, 번역 큐(호스트 사용량 집계), 수동 정정 | 테스트: Last-Event-ID 재전송, 동시 두 구독자, 정정 broadcast |
| 4 | 호스트·게스트 화면, 초대 복사, PTT 재사용, 참가자별 관점 렌더, 종료·발행·다운로드 | 컴포넌트 테스트 + E2E 두 브라우저 컨텍스트(호스트/게스트) 3 뷰포트, 가로 오버플로 0 |
| 5 | `same_room` 모드: 언어 규칙·라벨 연속성·등록 문장·정정 UI | evals 매니페스트에 같은 방 시나리오 추가, 귀속 정확도 기록 |
| 6 | 고객 가이드 ja/en/ko "통역 회의실" 절, CHANGELOG, 릴리즈 | 가이드 생성 스크립트 통과, provider명 0 |

각 단계는 테스트 먼저 작성하고 lint·typecheck·test·build를 통과한 뒤 다음 단계로 간다. 1–4단계(`remote` 모드)가 첫 고객 시연 범위다.

**진행 상황 (2026-09-16)**: 0–4단계 구현 완료(`feat/shared-interpreter-room` 브랜치). 소유자 로컬 테스트 피드백으로 초대 모달·복사, live 양방향 번역 즉시 반영, 게스트 화면 언어 전환, 재입장 이름 변경, 잘못된 링크 안내, Word/PDF(인쇄)/Markdown 선택과 미리보기를 추가. 5단계 중 서버 귀속 규칙과 수동 정정 API/토글은 포함됐고, 입장 시 등록 문장 UI와 evals 시나리오는 미착수. 6단계(고객 가이드 ja/en/ko)는 미착수.

## 7. 열어 둔 질문

- `same_room` 모드에서 호스트가 아닌 게스트 기기로 마이크를 쓰고 싶을 때(호스트 폰 배터리 등)의 마이크 이양은 후속.
- 다자(3인 이상) 회의실은 ADR 0028의 범위 밖이며 SSE→WebSocket 전환 판단과 함께 재검토.
