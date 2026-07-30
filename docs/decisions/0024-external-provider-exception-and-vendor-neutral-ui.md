# 0024 — 외부 provider 예외와 vendor 중립 UI

- **날짜:** 2026-07-30
- **상태:** 채택됨

## 무엇을 결정했나

로컬 CLI/Ollama만 허용하던 $0·loopback-only 원칙에 **명시적 예외 두 가지**를 도입한다.

1. **실시간 전사·번역 provider(스트리밍 STT/TTS).** `.env.local`의 `SONIOX_API_KEY`가 있을 때만 활성화된다. 장수 키는 서버 환경에만 존재하고, `/api/realtime/temporary-key`가 60초 single-use 임시 키만 브라우저에 발급한다(`redirect:"error"`, 10초 timeout, 장수 키·provider 응답 본문 미노출). 이 route는 이 저장소에서 유일하게 허용되는 비-loopback egress이며, 대상 host는 provider의 고정 HTTPS endpoint 하나다.
2. **외부 요약 모델 API(고객사 배포용).** `.env.local`의 `CODEX_API_KEY`(fallback `OPENAI_API_KEY`)가 있으면 `codex-cli` backend가 CLI 대신 provider HTTPS completion API를 직접 호출한다. 키가 없으면 기존 CLI 폴백을 유지한다. 키는 핸들러 안에서 지연 조회하고(build-green), 저장·로그·응답에 절대 넣지 않으며 실패는 opaque 코드(`summary_api_status_*`)로만 드러낸다.

**Vendor 중립 UI 계약:** 사용자에게 보이는 모든 표면(화면 문구, i18n 카탈로그, 상태 칩, 오류 메시지, URL 경로)은 외부 provider의 상호(Soniox, Codex, OpenAI 등)를 노출하지 않는다. 실시간 도구 페이지는 `/live`, 키 발급은 `/api/realtime/temporary-key`를 사용한다. 사이드바 시스템 상태는 `로컬`(전사)과 `외부 모델` 두 행으로 단순화하고, 로컬 전사는 엔진·모델명(Whisper, large-v3 등) 없이 준비 상태만 보여 준다. Provider의 raw error text는 렌더하지 않고 generic 메시지 + 숫자 코드로 대체한다. 내부 코드 식별자(`sonioxRealtime.ts`, `SonioxWorkspaceClient` 등)와 env 변수 이름은 이 계약의 대상이 아니다.

**앱은 여전히 API 키를 저장하지 않는다.** 두 키 모두 gitignored `.env.local`에만 있으며 `data/settings.json`·runtime metadata에 기록하지 않는다. 키가 없으면 로컬 녹음·전사·요약(CLI/Ollama)은 기존대로 완전히 동작한다.

## 왜

이 앱은 고객사 데모·판매용으로도 배포된다. 두 가지 현실이 원칙과 충돌했다: (1) 실시간 자막·양방향 번역은 로컬 모델로는 지연·품질을 맞출 수 없어 스트리밍 provider가 필요하고, (2) 고객사 PC에는 CLI가 설치·인증되어 있지 않아 CLI-only 요약은 데모에서 실패한다. 키를 운영자가 `.env.local`로 주입하는 구조는 "앱이 키를 저장하지 않는다"는 보안 속성을 유지하면서 두 문제를 푼다. 상호 비노출은 고객사가 화면만 보고 자체 구현 경로를 역산하는 것을 늦추기 위한 영업 요구이며, 보안 관점에서도 provider 응답·이름을 클라이언트에 흘리지 않는 쪽이 leak 표면을 줄인다.

## 버린 대안

- 임시 키 없이 장수 키를 브라우저에 직접 전달 — 키가 devtools/네트워크 탭에 노출되어 기각.
- 요약 API 키를 설정 화면에서 입력받아 `data/settings.json`에 저장 — "앱은 키를 저장하지 않는다" 원칙을 실제로 깨므로 기각. env 주입은 운영자 소유라 앱 데이터 계약 밖이다.
- 외부 요약을 별도 provider 항목으로 추가(4번째 backend) — 설정 UI·health·문서 표면이 늘고 CLI 폴백과 중복이라 기각. 기존 `codex-cli` backend의 실행 모드 분기로 흡수.
- UI에서 provider 이름을 유지 — 영업 요구(자체 구현 방지)와 상충해 기각.
