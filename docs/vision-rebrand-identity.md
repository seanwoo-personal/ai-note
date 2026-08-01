# Vision 리브랜드 — 정체성·권리 근거 (first-party research)

> 대상: 일본의 해외여행용 포켓 Wi-Fi 라우터 렌탈 회사 **Vision(株式会社ビジョン / Vision Inc.)**.
> 목적: 고객사 데모용 리브랜드의 근거를 first-party(공식·1차) 출처로만 확립하고, 로고/브랜드 자산의 사용 권리 여부를 기록한다.
> 조사일: **2026-08-01**. 검색·본문 추출은 WebSearch/WebFetch로 수행. 아래 timestamp는 해당 날짜의 **date-level, JST(Asia/Tokyo)** 로 기록한다(정확한 분 단위는 검증 불가 → 날조하지 않고 date-level로 명시).

관련 결정: **[ADR 0025 — Vision 고객사 브랜드와 분리된 시스템 상태 행](decisions/0025-vision-customer-brand-and-split-system-rows.md)**(이 조사가 근거가 된 결정) · [ADR 0024 — 외부 provider 예외와 vendor 중립 UI](decisions/0024-external-provider-exception-and-vendor-neutral-ui.md).

---

## 1. 결론 (높은 신뢰도)

의도한 "Vision"은 **株式会社ビジョン / Vision Inc.**(도쿄증권거래소 프라임, 증권코드 **9416**)이며, 그 **GLOBAL WiFi(グローバルWiFi)** 사업이 해외여행용 포켓 Wi-Fi 라우터를 렌탈한다.

| 항목 | 값 |
|---|---|
| 법인명(JP) | 株式会社ビジョン |
| 법인명(EN) | Vision Inc. |
| 본사 | 東京都新宿区新宿六丁目27番30号 新宿イーストサイドスクエア8階 (Shinjuku East Side Square 8F) |
| 설립 | 2001-12-04 (창업 1995-06-01) |
| 상장/코드 | 東証プライム, 증권코드 **9416** |
| 공식 코퍼레이트 도메인 | **vision-net.co.jp** |
| Wi-Fi 렌탈 서비스 브랜드 | **GLOBAL WiFi / グローバルWiFi** |
| 주요 서비스 도메인 | **townwifi.com** (Vision이 밝힌 도메인: global-wifi.com, townwifi.com, ninjawifi.com 외) |

**코퍼레이트 → 브랜드 → 도메인 체인:** 株式会社ビジョン / Vision Inc.(TSE Prime 9416, Shinjuku East Side Square 8F) — 코퍼레이트 도메인 **vision-net.co.jp** — GLOBAL WiFi 해외 포켓 Wi-Fi 렌탈 브랜드 — 주 서비스 **townwifi.com**.

---

## 2. First-party 근거 (단일 출처 아님 — 3개 독립 1차 페이지가 일치)

| # | URL | 페이지 title(렌더링) | 취득 | first-party | 확립하는 사실 |
|---|---|---|---|---|---|
| A | `https://www.vision-net.co.jp/company/com_data.html` | 会社概要｜会社情報 \| 株式会社ビジョン | 2026-08-01, date-level, JST | YES(회사 소유 도메인) | 법인명·본사·자본·설립·대표, "東証プライム上場（証券コード：9416）", 세그먼트 "グローバルWiFi事業" |
| B | `https://www.vision-net.co.jp/en/solution/globalwifi.html` | GLOBAL WiFi Service \| Vision | 2026-08-01, date-level, JST | YES | Vision Inc.이 "GLOBAL WiFi" Wi-Fi 렌탈 브랜드를 소유, 운영 도메인 목록, footer "© Vision Inc." → 코퍼레이트→브랜드→도메인 체인 |
| C | `https://townwifi.com/` · `https://townwifi.com/kiyaku/` | 利用規約 ｜【公式】海外のWiFiレンタルはグローバルWiFi | 2026-08-01, date-level, JST | YES(공식 서비스 도메인) | 운영사 = 株式会社ビジョン(9416), 동일 본사, "© Vision Inc.", 「グローバルWiFi」「Vision Global WiFi」는 등록상표 |

**Namesake 배제 근거:** "Vision"은 동명 회사가 매우 많다(Media.Vision, Arts Vision 등). 배제는 오직 이 법인만 만족하는 사실들의 결합으로 한다 — (1) TSE Prime 고유 증권코드 **9416**(코퍼레이트 프로필과 서비스 사이트 양쪽에 표기), (2) GLOBAL WiFi 해외 렌탈 사업이 세그먼트로 명시, (3) 동일 등록 본사(Shinjuku East Side Square 8F)가 코퍼레이트·서비스 도메인 양쪽에 표기, (4) 자사 서비스 사이트의 「グローバルWiFi」 등록상표 선언. 검색에서 등장한 동명 회사(게임/성우 등)는 9416·GLOBAL WiFi·vision-net.co.jp↔townwifi.com 도메인 쌍을 갖지 않는다.

> 2차 출처(블로그/뉴스/위키)는 **정체성 근거로 사용하지 않았다**. 일부가 위 사실과 일관되나 약한 보강일 뿐이다.

---

## 3. 불확실성 (frank)

- **정확한 취득 시각:** 날짜(2026-08-01)와 JST 프레이밍은 확인 가능하나 분 단위는 검증 불가 → date-level로만 기록.
- **일부 literal `<title>`:** townwifi.com 홈과 IR outline 페이지는 fetch가 raw `<title>`을 깔끔히 반환하지 못해 렌더링 heading으로 대체 표기(추측 아님).
- **도메인 역할:** global-wifi.com은 Vision이 자사 도메인으로 명시했으나 이번 pass에서 직접 fetch하지 않음. townwifi.com만 라이브 확인.
- **로고 권리:** first-party에서 제3자 로고 사용을 명시적으로 허가한 근거 없음(아래 §4). 연락 폼 뒤의 미디어/프레스 킷 존재 가능성은 배제 불가.

---

## 4. 로고 / 브랜드 자산 권리 인벤토리

**핵심 결론(BLUF):** Vision·GLOBAL WiFi 로고를 제3자가 사용·복제·변형할 권리를 **명시적으로 부여하는 first-party 근거는 존재하지 않는다.** 오히려 자사 이용약관이 등록상표·전 IP 유보를 선언한다. → **공식 로고 자산을 복제·임베드·변형·트레이싱하지 않는다.**

| 자산 | 원본 URL | 취득 | 묘사 | 명시된 권리/사용성 |
|---|---|---|---|---|
| Vision 코퍼레이트 헤더 로고 | `https://www.vision-net.co.jp/common/img/header_logo.svg` | 2026-08-01, JST | Vision Inc. 워드마크(alt "株式会社ビジョン") | 사용 허가 없음. footer "© Vision Inc."만 |
| TSE Prime 마켓 로고 | `https://www.vision-net.co.jp/common/img/toshoitibu_logo.svg` | 2026-08-01, JST | 도쿄 프라임 마켓 로고 | 제3자(TSE) 마크 — Vision이 라이선스할 대상 아님. 재사용 금지 |
| GLOBAL WiFi 서비스 로고 | `https://townwifi.com/common/images/page/logo/globalwifi_logo.svg` | 2026-08-01, JST | GLOBAL WiFi 워드마크 | 등록상표 선언, 재사용 허가 없음 |
| 2018 리뉴얼 GLOBAL WiFi 로고 이미지 | `https://www.vision-net.co.jp/news/20180808001678.html` 내 이미지 | 2026-08-01, JST | 지구+Wi-Fi 심볼, 약간 이탤릭 로고타입 | 프레스 릴리스 이미지, 라이선스 부여 없음 |

**약관 인용(권리 유보):** `https://townwifi.com/kiyaku/` — 「グローバルWiFi」及び「Vision Global WiFi」は登録商標です。 / 「本サービスに関する一切の知的財産権は当社又は当社の契約する第三者に帰属します」 / 「改変、リバース・エンジニアリング…」 금지. 코퍼레이트·서비스 footer: 「© Vision Inc.」.

**잔여 법적 리스크:** 마크는 등록상표이고 전 IP가 유보되어 있어, 서면 허가 없이 로고를 복제/임베드/변형하면 상표·저작권 침해 리스크. TSE Prime 로고는 제3자 마크로 사용 금지.

### 이 저장소의 준수 방식 (구현된 대로)
- **공식 로고 자산 미사용.** 헤더는 **타이포그래피 전용 `Vision` 워드마크**(복제 그래픽 자산 없음)로 구현 — `src/components/BrandWordmark.tsx`, 문자열 단일 소스는 `src/lib/brand.ts`.
- 이 타이포 fallback은 **공식 로고 수용 기준을 완전히 충족하지 않는다.** 공식 로고 사용은 Vision의 서면 라이선스 또는 저장소 내 고객 승인 근거가 확보된 뒤에만 가능하다(현재 없음). 이 사실을 여기 명시하며, PASS를 날조하지 않는다.

---

## 5. 브랜드 비주얼 언어 (first-party만 — 추측 금지)

2018 로고 리뉴얼 프레스(`https://www.vision-net.co.jp/news/20180808001678.html`, 2026-08-01 JST)에서:
- **로고 개념(인용):** 「地球マークとWiFiマークを組み合わせた、シンプルで力強い新ロゴマーク…少し斜体がかったロゴタイプ…」 — 지구+Wi-Fi 결합의 단순·강한 마크, 약간 이탤릭 로고타입(국경·제약을 넘는 선진성 상징), 안심/신뢰 톤.
- **공식 브랜드 컬러(hex):** **미공개 / 추측 금지.** 취득한 어느 first-party 페이지도 hex 팔레트를 공개하지 않는다.
- **타이포그래피(폰트명):** **미공개 / 추측 금지.** 로고타입은 "약간 이탤릭"으로만 서술, 폰트 패밀리 명시 없음.
- **간격/클리어스페이스/타입스케일 스펙:** 취득 페이지에 미공개.

→ 공식 팔레트·폰트가 미공개이므로, 디자인 토큰을 로고에서 역산하지 않는다. 리브랜드는 **기존 검증된 디자인 시스템을 유지**하고 Vision 워드마크만 도입한다([vision-rebrand-design-and-inventory.md](vision-rebrand-design-and-inventory.md) 참조).
