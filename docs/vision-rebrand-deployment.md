# Vision 리브랜드 — 배포 대상 조사 (source-first)

> 목적: 리브랜드된 앱을 배포할 **hosted production 대상이 저장소에 정의되어 있는지**를 source-first로 확인하고, 없으면 정확한 blocker(누락된 target/credential)를 기록한다. Kanban block 여부는 구현·게이트 후 외부 orchestrator가 판단한다.

## 조사 결과 (2026-08-01, source-first)

| 확인 항목 | 결과 |
|---|---|
| `.github/workflows/` | `ci.yml` **하나만** 존재(빌드/테스트 게이트). deploy 워크플로 없음. |
| GitHub Environments | 없음 |
| GitHub Deployments | 없음 |
| GitHub Pages 사이트 / `CNAME` | 없음 |
| `vercel.json` / `netlify.toml` / 기타 호스팅 설정 | 없음 |
| 로컬 owned production-style 런타임 | `http://localhost:3100` (owned background runtime) — **hosted production 아님** |

## 결론 / blocker

- 저장소에 **배포 대상이 정의되어 있지 않다.** `ci.yml` 외 배포 설정·환경·GitHub Pages·외부 호스팅 설정이 전무하다.
- 로컬 `http://localhost:3100`은 owned 로컬 런타임이며 **호스티드 프로덕션이 아니다.**
- **배포를 위해 누락된 것(정확한 blocker):**
  1. **배포 target 정의** — 호스팅 provider/환경(예: 정적 export 대상, 노드 호스트, 또는 GitHub Pages/Environment) 중 무엇도 저장소에 없음.
  2. **배포 credential/권한** — 위 target이 없으므로 연결된 토큰/환경 시크릿도 없음.
- **금지 준수:** 배포 target을 **발명하거나 구성하지 않는다.** DNS/계정/권한을 변경하지 않는다. hosted production PASS를 날조하지 않는다.

## 권고

- 리브랜드 코드/테스트/문서는 완성 상태로 두고, 배포는 **target·credential이 명시적으로 제공된 뒤** orchestrator가 진행한다.
- 로컬 검증은 owned 런타임(`npm run app:start`, `http://localhost:<actual-port>`)으로만 수행한다.
