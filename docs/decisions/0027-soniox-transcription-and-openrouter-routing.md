# ADR 0027 — Soniox 전사와 OpenRouter 작업별 라우팅

## 상태

채택됨 — ADR 0001의 로컬 Whisper 런타임, ADR 0012·0014의 Whisper 서비스 경계, ADR 0024의 고객 배포용 OpenAI 직접 호출 결정을 대체한다. 기존 `status.whisper`와 `.whisper-dispatch.json` 이름은 저장 데이터 호환용으로만 유지한다.

## 결정

1. 녹음 종료 후 전사는 Soniox `stt-async-v5`를 사용한다. 업로드·전사 ID를 status에 저장하고 앱 재시작 뒤에도 상태 조회를 재개한다.
2. 언어 힌트는 한국어·일본어·영어·중국어이며 언어 식별과 화자 분리를 활성화한다.
3. 검증한 `segments.json`을 먼저, `raw.md`를 completion marker로 마지막 발행한다. 발행 뒤 Soniox 전사와 업로드 파일은 최선 노력으로 삭제한다.
4. 생성형 작업은 OpenRouter를 기본 provider로 사용한다. 교정·번역은 저비용 체인, 요약·채팅은 품질 체인을 우선하며 provider는 가격순으로 고른다.
5. 모델 또는 provider 장애에는 선언한 후보 순서로 fallback한다. 요청은 ZDR과 provider 데이터 수집 거부를 요구한다.
6. `SONIOX_API_KEY`와 `OPENROUTER_API_KEY`는 서버 환경 변수에서만 지연 조회한다. redirect를 거부하고 timeout을 적용하며 provider 응답 본문이나 키를 public 오류·로그·데이터 파일에 남기지 않는다.

## 결과

- Python·`uv`·로컬 Whisper 모델·별도 Whisper HTTP 프로세스가 런타임과 설치에서 제거된다.
- 인터넷 연결은 필수다. 회의 오디오는 Soniox로, 전사 문맥은 활성화된 OpenRouter 모델 제공자로 전송된다.
- 고객 테스트 배포는 Docker 앱과 HTTPS 터널만 필요하다.
- Filesystem 데이터는 계정별 `data/tenants/{sha256}` 루트로 분리되지만 상용 멀티테넌시는 아니므로 테스트 인스턴스에는 계약된 고객사만 승인한다(ADR 0026, 2026-09-14 갱신).
