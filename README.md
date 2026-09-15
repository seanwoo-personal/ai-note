# AI NOTE

AI NOTE는 회의를 녹음하고, Soniox로 전사한 뒤, OpenRouter 모델로 스크립트 교정과 회의록 요약을 만드는 웹 앱입니다. 고객 가입 신청, 운영자 승인, 결제 상태에 따른 접근 차단, 계정별 사용량 집계가 기존 녹음·라이브·회의 보관 화면과 연결되어 있습니다.

## 현재 흐름

```text
브라우저 녹음 → 원본 오디오 저장 → Soniox 비동기 전사 → OpenRouter 교정·요약 → 열람·검색·내보내기
```

- 고객은 `/signup`에서 가입을 신청합니다.
- 운영자가 `/admin`에서 승인하고 결제 완료로 표시해야 로그인할 수 있습니다.
- 로그인 후 기존 AI NOTE 홈(`/`)과 녹음·라이브·회의 보관 기능을 사용합니다.
- 고객은 로그인 화면에서 가입 이메일로 30분 유효·1회용 임시 비밀번호를 받고, 로그인 직후 새 비밀번호로 반드시 변경합니다.
- 최초 최고 운영자는 `/admin/setup`에서 한 번만 생성합니다.
- 추가 운영자는 24시간 유효한 일회용 초대를 받고 TOTP 이중 인증 또는 복구 코드를 사용합니다.
- 미결제·연체·차단으로 변경하면 현재 고객 세션도 무효화됩니다.

> 승인된 고객 계정마다 회의·라이브러리·단어장·개인 설정·검색 인덱스는 계정 ID를 해시한 서버 전용 데이터 루트(`data/tenants/{sha256}`)로 분리되며, 모든 데이터 API와 데이터 페이지가 로그인 세션에서만 계정을 결정합니다. 요약 모델 설정(`data/settings.json`)과 계정 파일(`data/system/`)은 서버 전역입니다. 다만 파일 기반 단일 서버 구성은 고객 테스트용이며 결제 서비스의 서명된 웹훅, 조직 권한, 감사 로그를 갖춘 상용 멀티테넌시가 아닙니다. 테스트 인스턴스 하나에는 계약된 고객사만 승인하세요. 근거는 [결정 기록 0026](docs/decisions/0026-local-account-gate-before-hosted-multitenancy.md)에 있습니다.

## 요구 사항

- Node.js 20 이상
- ffmpeg
- Soniox API 키
- OpenRouter API 키(스크립트 교정·요약을 사용할 때)

Python, `uv`, 로컬 Whisper 모델은 필요하지 않습니다.

## 로컬 실행

```sh
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local`에 다음 서버 전용 키를 입력합니다. 키를 브라우저 코드에 넣거나 Git에 커밋하지 마세요.

```dotenv
SONIOX_API_KEY=실제_키
OPENROUTER_API_KEY=실제_키
```

비밀번호 복구 메일을 사용하려면 `.env.local` 또는 배포 환경에 TLS SMTP 서버와 `AI_NOTE_SMTP_*` 발신 자격증명도 설정합니다.

기본 로컬 주소는 `http://127.0.0.1:3000`입니다. 포트가 이미 사용 중이면 `npm run dev -- --port 3100`처럼 지정할 수 있습니다.

## AI와 전사 구성

- 녹음 종료 후 Soniox `stt-async-v5`가 언어 식별과 화자 분리를 포함한 비동기 전사를 수행합니다.
- 스크립트 교정·번역은 저비용 모델을 우선하고, 요약·채팅은 품질 우선 모델을 먼저 사용합니다.
- OpenRouter가 지정된 후보 모델을 순서대로 대체하고, 같은 모델의 제공자는 가격순으로 선택합니다.
- OpenRouter 요청에는 제로 데이터 보존과 데이터 수집 거부 조건을 적용합니다.
- Soniox 원격 전사와 업로드 파일은 결과 게시 후 최선 노력으로 삭제합니다.

## 로컬 검증 명령

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run check:links
```

## AWS 테스트 배포

별도 도메인 없이 AWS Lightsail과 Cloudflare Quick Tunnel로 임시 HTTPS 테스트 주소를 만들 수 있습니다. Docker 구성, AWS 계정 생성, 키 설정, 운영자 생성, 고객 승인 절차는 [AWS 고객 테스트 배포 안내](docs/AWS_DEPLOYMENT.md)를 따르세요.

```sh
cp .env.production.example .env.production
docker compose up -d --build
docker compose logs tunnel
```

터널 로그의 `https://...trycloudflare.com` 주소를 고객에게 전달합니다. Quick Tunnel 주소는 테스트 전용이며 다시 만들면 바뀔 수 있습니다.

## 주요 경로

| 경로 | 역할 |
|---|---|
| `src/app/` | Next.js 화면과 API |
| `src/components/` | 녹음·회의·인증·운영자 UI |
| `src/services/sonioxAsync.ts` | Soniox 비동기 전사 |
| `src/services/llm/openRouter.ts` | OpenRouter 모델 라우팅 |
| `data/` | 회의·계정·설정 데이터(커밋 제외) |
| `docs/` | 제품·구조·배포 문서 |

## 배포 보안

- Docker 앱 포트는 서버의 `127.0.0.1`에만 바인딩하고 HTTPS 터널만 외부에 노출합니다.
- 변경 요청은 같은 출처인지 검증하며, 안정된 도메인을 붙이면 `APP_ORIGIN`으로 정확한 HTTPS 원본을 고정합니다.
- 루트 운영자 비밀번호와 TOTP 복구 코드는 안전한 비밀번호 관리자에 보관합니다.
- API 키와 `data/` 볼륨을 백업하되 로그나 고객 응답에 노출하지 않습니다.

## 라이선스

[MIT](LICENSE) © 2026 Dylan
