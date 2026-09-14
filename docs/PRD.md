# PRD: 회의 녹음 → 회의록 요약 (AI NOTE)

## 목표

브라우저 마이크로 회의를 녹음하면 → Soniox가 비동기 또는 실시간 전사하고 → OpenRouter의 작업별 모델 체인이 맥락 기반으로 오타를 교정하고 읽기 좋은 회의록으로 요약한다. 고객은 가입 신청 뒤 운영자의 승인과 결제 확인을 받아 기존 AI NOTE 홈을 사용한다. 완성된 요약은 열람·내보내기(export)할 수 있고 파생 검색 데이터로 여러 회의의 결정·할 일·출처를 AI 없이 찾을 수 있다.

## 사용자

고객사 사용자와 Vision 운영자. 현재 원격 테스트는 승인된 고객 계정마다 회의·라이브러리·단어장·개인 설정의 저장 범위를 분리한다. 회사 단위 역할과 정산을 포함한 상용 조직 모델은 후속 범위다.

## 핵심 기능 (MVP-0)

1. **녹음** — 브라우저 마이크로 오디오를 캡처한다. 레벨미터·타이머로 "녹음되고 있음"을 확인하고 페이지 이탈을 경고하며, 필요하면 Soniox 실시간 자막·번역을 함께 사용한다.
2. **배치 전사** — 녹음 종료 시 Soniox `stt-async-v5`가 전체 오디오를 전사한다. 언어 식별, 화자 분리, 세그먼트 타임스탬프를 포함한다.
3. **최초 교정 + 요약** — 전사가 끝나면 앱의 백그라운드 워커가 OpenRouter로 최초 자동 전사 원문을 교정한 전체 스크립트와 그 스크립트에 근거한 구조화 요약을 차례로 만든다. 교정·번역과 요약·채팅은 비용·품질 요구에 맞춰 서로 다른 모델 우선순위를 사용한다.
4. **2탭 상세·수동 수정** — 웹에서 회의별 상세를 **전체 스크립트 / 회의록 요약** 두 탭으로 열람하고 각각 직접 수정·저장한다. 선택된 탭의 로컬 작업은 tablist 바로 다음, 경고와 본문보다 앞에 둔다. 수정 중에는 읽기 본문을 하나의 multiline textarea로 교체하며, 요약은 생성된 heading·bullet을 포함한 전체 읽기 본문을 자유 plain text 하나로 편집한다. 제목은 목록의 전용 제목 수정, 참석자는 상세 `회의 정보` 입력에서만 바꾼다.
5. **내보내기(export)** — 완성된 회의록 요약을 열람하고 파일로 내보낸다. 이후 활용(공유·아카이브 등)은 사용자가 결정한다.
6. **회의록 관리** — 회의 목록에서 요약 완료된 회의의 **제목 수정**(AI 자동 제목을 사람이 교정, `titleOverride`로 보존)과 불필요한 회의록 **영구 삭제**(인라인 확인).
7. **단어 관리(단어장) + 좌측 네비게이션** — 도메인 용어와 '잘못 인식→올바른 표기' 교정쌍을 웹 **단어 관리** 탭에서 관리(OpenRouter 교정 단계에 반영). 좌측 사이드바로 회의·단어·설정을 오간다.
8. **로컬 회의 라이브러리** — desktop rail/mobile drawer에서 workspace를 전환하고 모든 회의·미분류·최대 3단계 folder의 direct meeting을 bounded page로 본다. Workspace/folder 생성·이름 수정과 folder semantic color 편집을 제공한다. Meeting은 same/cross-workspace의 folder·미분류로 이동할 수 있고 folder subtree는 같은 workspace 안에서만 reparent한다. Folder 삭제는 direct meeting rehome+child 승격, workspace 삭제는 destination unfiled rehome이며 둘 다 preview 뒤 조직 metadata만 제거하고 meeting artifact를 보존한다. 중앙 `library.json` placement/tree metadata만 바꾸며 Meeting artifact는 안정적인 `data/meetings/{id}/`에 둔다. Workspace는 계정·팀·권한·암호화 또는 물리 저장 경계가 아니다. Registry degraded 시 last-good/global fallback을 읽기 전용으로 제공하고, corrupt에만 fingerprint 확인·원본 archive 보존형 명시적 재구축을 제공한다. Unsupported/I/O/conflict는 덮지 않는다.
9. **단건 독립 재생성** — 요약 완료 회의에서 두 operation을 분리한다. **"원문에서 스크립트 다시 만들기"**는 최초 자동 전사 원문과 현재 단어장으로 전체 스크립트만 교정하고 기존 요약을 보존한다. **"현재 스크립트로 요약 다시 만들기"**는 현재 저장된 전체 스크립트로 요약만 만들고 스크립트를 보존한다. 스크립트 변경 뒤 기존 요약은 삭제하지 않고 **"요약 갱신 필요"**로 표시하며, 요약 직접 저장 또는 재생성 뒤 다시 최신 상태가 된다. **자동·일괄 재생성은 비목표**이고 단어장 저장도 기존 회의를 자동 갱신하지 않는다.
10. **회의 지식 검색·질문 확장** — 파생 지식 카드와 corpus map으로 전체 회의를 결정적으로 검색하고, OpenRouter를 재사용하는 도구 호출형 챗봇이 서버가 실제 read·live 재검증한 근거에만 claim-level inline citation과 reference list를 제공한다. **단, 챗봇(질문/회의 도우미) UI는 현재 dormant다** — build-time flag `MEETING_ASSISTANT_ENABLED`(기본 `false`)로 마운트만 차단하고 코드·`/api/chat`·공유 지식 인덱스는 보존한다(ADR 0019). AI 없는 단순 검색과 검색 파생물은 dormant와 무관하게 동작한다. 아래 서술은 챗봇을 되살릴 때(flag=`true`)의 목표 계약이다. 번호·현재 제목·링크는 서버가 만들며, 사용자 프로필은 선택적 개인화라 미설정이어도 일반 검색·질문은 동작한다. 질문 응답은 non-streaming이고 완결 4 turn의 현재 탭 메모리만 사용한다. 진입은 별도 `/search` 페이지가 아니라 앱 셸의 두 표면이다: 좌측 사이드바 최상단 돋보기 `검색` 트리거가 여는 검색 오버레이와, 우측 접이식 `회의 도우미` 챗봇 패널(모바일은 drawer). 챗봇은 요약 기반 `search_meetings` 외에 전사 본문을 훑는 discovery 전용 `search_transcripts` 도구를 가져 고유명사·별칭이 요약에서 사라진 회의도 후보로 찾되, discovery 결과 자체는 근거가 아니며 그 회의를 요약·전사 도구로 다시 읽어야 citation이 된다. AI 없는 단순 검색은 여전히 전사 전문을 읽지 않는다.
11. **설치·첫 실행** — Clone 뒤 `npm ci`, 환경 파일 복사, `npm run setup`, `npm run dev`로 로컬 실행한다. 고객 테스트는 Docker와 HTTPS 터널로 배포하며 `SONIOX_API_KEY`와 `OPENROUTER_API_KEY`가 필요하다. 첫 화면은 요약 모델 미설정/불가를 recorder 앞에서 비차단으로 안내한다.
12. **전사 실패 복구·완료 기본 보기** — `retry_transcription`은 목록·상세·저장 결과에 지속 표시하고 exact meeting ID로 기존 durable transcribe API를 다시 호출한다. 완료 회의는 explicit query가 없고 usable summary가 있으면 **회의록 요약**을 기본 tab으로 연다.
13. **고객 비밀번호 복구** — 웹과 Android 고객 로그인에서 가입 이메일로 비밀번호 복구를 요청한다. 계정 존재 여부는 응답으로 구분하지 않으며 30분 유효·1회용 임시 비밀번호를 TLS SMTP로 발송한다. 임시 비밀번호 로그인 뒤에는 제품 화면보다 새 비밀번호 설정을 먼저 강제하고, 변경 시 기존 고객 세션을 모두 폐기한다. 운영자 계정 복구는 이 흐름에 포함하지 않는다.
14. **글로벌 미팅의 미디어 경계** — 서로 무관한 유튜브 영상이나 음원을 연속 재생할 때 사용자는 콘텐츠가 바뀌기 전에 `새 영상·음원`을 누른다. 앱은 현재 발화를 확정하고 실시간 화자 세션만 새로 시작하되 기존 대화 기록과 회의 저장 흐름은 유지한다. 새 세션의 화자 번호는 기존 기록과 겹치지 않게 이어 붙인다. 일반 회의의 짧은 침묵만으로는 자동 초기화하지 않는다.

## MVP 제외 사항 (비목표)

- 캘린더 연동, 데스크탑 전용 앱
- 공유 편집, cloud sync, 템플릿 관리 UI, 자동 결제 수납, MCP
- 여러 고객사를 한 인스턴스에서 안전하게 분리하는 상용 멀티테넌시
- vector DB/embedding 기반 semantic search · 모델의 임의 파일 접근/출처 번호 생성 · streaming/background chat job · 서버 영구 대화 기록
- 최초 자동 전사 원문 직접 수정, 수동 수정 이력/merge UI, autosave
- 최초 생성 뒤 스크립트 교정과 요약을 한 번에 다시 실행하는 결합 재생성, 스크립트 변경 직후의 무확인 자동 요약 갱신

### v2로 명시적 연기
chunk-append 크래시 복구 + 디코드 게이트 · 전체 상태 FSM + stale-job 워치독 · map-reduce 요약/refine 청킹 · auto-queue-on-green · 세그먼트 클릭 재생 · 무음 워치독/장치 선택/일시정지 · capture_id 재스캔 idempotency.

## 아키텍처/제품 상 유의점

- **자동 요약 워커**: 전사가 끝난 최초 한 번만 앱이 백그라운드 워커로 OpenRouter를 호출해 교정본과 그 교정본의 요약을 만든다. 이후 스크립트·요약 생성은 상세에서 사용자가 종류별로 명시적으로 시작하며 서로를 자동 재생성하지 않는다.
- **자동 전사 on stop**: 녹음 종료 시 앱이 Soniox 비동기 전사를 자동 위임하고 원격 ID를 저장해 재시작 뒤에도 이어서 확인한다.
- **검색·질문 경계**(질문/챗봇 표면은 현재 dormant, ADR 0019 — 아래는 보존되는 계약): 단순 검색은 LLM을 호출하지 않고 `knowledge-card.json`/`corpus-map.json`과 query-time live metadata만 사용한다(전사 전문 미열람). 수동 자유 본문은 `회의록 본문`으로 검색하지만 그 text에서 action item·담당자·기한을 추론하지 않는다. 질문은 서버의 OpenRouter 설정을 재사용하며 서버는 bounded tool output과 citation provenance를 검증한다. 챗봇 도구 계층에만 discovery 전용 `search_transcripts`가 있어 bounded snippet으로 전사 본문을 훑지만 citation credit은 주지 않는다. 프로필·검색 파생물은 `data/`에만 저장하고 대화 history는 서버 파일에 저장하지 않는다.
- **중단 안전 저장**: 녹음 종료 저장은 body 전에 intent를 고정하고 audio+initial status를 한 directory로 publish한다. 응답 유실 뒤 같은 meeting ID로 재시도하면 원본 오디오를 덮지 않고 playback·위치·전사 상태를 복구한다.
- **범위별 recorder 위치·복구 UX**: Ready의 Workspace All/미분류는 해당 workspace 미분류, folder는 exact folder를 녹음 시작 순간 ID로 고정한다. Last-good은 마지막 위치를 요청하되 실제 배치가 unavailable/fallback일 수 있음을 먼저 알리고, fresh global fallback은 조직 위치 없이 저장한다. 응답 유실·5xx에서는 같은 ID를 body 없이 probe한 뒤 미게시가 확인된 경우에만 보존 Blob을 다시 전송한다. 저장 결과는 원본 내구성·실제 위치·재생 준비·전사를 각각 표시한다.
- **원본 불가침**: `audio.webm`·`raw.md`·`segments.json`은 불변. `transcript.md`·`summary.json`은 언제든 재생성 가능.
- **파생 콘텐츠 최신성**: 전체 스크립트 직접 저장·재생성은 기존 요약을 보존하되 최신이 아님을 표시한다. 요약 직접 저장·재생성은 반드시 현재 전체 스크립트를 기준으로 하며, 저장 충돌이나 결과 불명확 상태에서는 사용자 입력을 보존하고 확인 없이 덮어쓰거나 재전송하지 않는다.
- **설치 target·runtime 경계**: 로컬 개발 서버는 loopback에만 바인딩하고, 클라우드 컨테이너의 앱 포트도 서버 loopback에만 공개한다. 고객 접근은 HTTPS 터널을 사용하고 안정된 도메인을 붙이면 exact `APP_ORIGIN`을 고정한다.
- **첫 실행 정직성**: `회의 녹음 시작`이 recording CTA다. Soniox/OpenRouter 키나 연결이 없으면 실제 진행 중인 것처럼 표시하지 않는다.
- **온라인 회의 소리**: 데스크톱 Chrome에서는 `마이크와 회의 소리`를 선택하고 공유 창에서 회의 탭의 오디오 공유를 켜 마이크와 탭 소리를 함께 녹음한다. Google Meet 같은 브라우저 탭 회의를 우선 지원하며 Zoom 데스크톱 앱 전체 소리는 운영체제·브라우저 지원에 따라 제한될 수 있다.
- **영상별 화자 문맥**: 실제 유튜브 4개 연속 재생 회귀에서 뒷 영상의 두 화자가 한 명으로 합쳐지거나 세 명으로 과분리되는 현상을 재현했다. 영상별 새 세션에서는 같은 뒷 영상이 두 화자로 회복됐다. 따라서 `새 영상·음원`은 기록을 지우는 동작이 아니라 화자 문맥만 교체하는 명시적 경계다.

## 디자인 방향

- 웜 베이지/브라운 미니멀, "도구처럼"(마케팅 페이지 아님). Pretendard.
- 상세는 2탭. 녹음 CTA는 다크 **"회의 녹음 시작"** 버튼. 자세한 규칙은 `UI_GUIDE.md`.
