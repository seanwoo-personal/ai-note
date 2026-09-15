# scripts — 유틸리티 스크립트

상위 진입점: [../AGENTS.md](../AGENTS.md) · 전체 계약: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

## 목적 Purpose / Owns
저장소 유지보수용 Node 스크립트를 소유한다.

- `scripts/check-links.mjs` — 마크다운 링크 무결성 체커(CI 게이트). 저장소 내 모든 `.md`의 상대 링크가 실재 파일/디렉토리를 가리키는지 검사, 깨진 링크가 하나라도 있으면 exit 1.
- `scripts/setup.mjs` — 설치 닥터(`npm run setup`). Node·`ffmpeg`·`.env.local`을 점검해 ✓/⚠/✗ 안내. **읽기 전용·무의존**(node 빌트인만 — `npm install` 전에도 실행). 바이너리는 실행하지 않고 PATH 존재만 확인. 순수 함수는 export하고 부수효과는 CLI 가드 뒤에서만 → `scripts/__tests__/setup.test.mjs`가 순수 함수를 주입식 의존으로 검증. CI/`postinstall`에 연결하지 않는다.
- 로컬 개발은 `npm run dev`, 고객 테스트 배포는 루트의 `docker-compose.yml`을 사용한다. 별도 Python 전사 프로세스나 background supervisor는 없다(ADR 0023 갱신).
- `scripts/meeting-summarize.mjs` — `/meeting-summarize` command가 호출하는 canonical 요약 진입점.
- `scripts/diarization-quality.mjs` — `evals/` manifest 기반 화자 분리 품질 채점(`scripts/__tests__/diarization-quality.test.mjs`).
- `scripts/build-customer-sales-guide.mjs` · `build-vision-japan-pricing-proposal.mjs` · `translate-customer-guide.mjs` · `customer-guide-localization.mjs`(+`customer-guide-translations.json`) — `public/customer-guide*.html`과 `artifacts/` 고객 자료 생성기. 고객 자료에는 provider·모델명을 넣지 않는다(`scripts/__tests__/customer-guide-localization.test.mjs`).
- `scripts/test-e2e-reporter-fail-closed.mjs` — evidence reporter의 fail-closed 계약을 실제 runner로 검증하는 수동 점검 도구(CI gate 아님).
- `scripts/e2e-doctor.mjs` — Node baseline, exact `@playwright/test` package, matching Chromium executable만 읽기 전용 점검한다. 설치·다운로드·파일 수정·network를 수행하지 않는다.
- `scripts/run-e2e.mjs` — loopback port와 OS temp snapshot의 최상위 owner. scrubbed Playwright env로 local CLI를 실행하고 성공/실패/정상 signal 뒤 snapshot을 반드시 제거한다.
- `scripts/e2e-server.mjs` — allowlist source를 runner-owned empty snapshot에 복사하고 empty `data/`, synthetic `HOME`, disabled worker와 FAKE provider로 Next를 `127.0.0.1`에 띄운다. 실제 `data/`·glossary·env·로컬 서비스에 접근 금지.
- `scripts/e2e-harness.mjs` — 위 경계의 순수/검증 helper와 allowlist 정본. 변경 시 `scripts/__tests__/e2e-harness.test.mjs`를 먼저 갱신한다.

## 자주 하는 변경 Common changes (patterns)
- **링크 검사 규칙 변경**: `scripts/check-links.mjs`의 `IGNORE_DIRS`/`LINK_RE`만 수정. 생성물·의존성 디렉토리(`node_modules`·`.next`·`data` 등)는 스캔에서 제외한다.
- **Browser QA 변경**: product scenario는 `e2e/**/*.spec.ts`, 공통 console/network/screenshot 수집은 `e2e/support/synthetic-test.ts`, execute manifest shape는 `e2e/support/evidence-reporter.ts`가 소유한다. Chrome DevTools MCP 호출이나 실제 사용자 data/service 의존을 추가하지 않는다.

## 의존 Dependencies (cross-module)
- setup/bootstrap/link/harness orchestration은 Node stdlib, browser doctor/runner는 pinned `@playwright/test` devDependency를 사용한다. 저장소 루트에서 실행한다.

```bash
npm run setup           # Node·ffmpeg·환경 파일 점검(읽기 전용)
npm run check:links     # 마크다운 죽은 링크 0 검사
npm run test:e2e:doctor # Playwright/Chromium 준비 상태(읽기 전용)
npm run test:e2e        # isolated synthetic Chromium regression
```
