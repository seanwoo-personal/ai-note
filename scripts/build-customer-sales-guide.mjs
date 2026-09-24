import { openSync, closeSync, fsyncSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  localizeCustomerGuide,
} from "./customer-guide-localization.mjs";

const root = resolve(import.meta.dirname, "..");
const imageRoot = join(root, "artifacts", "ai-note-customer-guide-assets");
const outputs = [
  { locale: "ja", path: join(root, "artifacts", "Vision_AI_Meeting_Agent_Customer_Guide_JA.html") },
  { locale: "en", path: join(root, "artifacts", "Vision_AI_Meeting_Agent_Customer_Guide_EN.html") },
  { locale: "ko", path: join(root, "artifacts", "Vision_AI_미팅_에이전트_고객사용가이드.html") },
  { locale: "ja", path: join(root, "public", "customer-guide.html") },
  { locale: "en", path: join(root, "public", "customer-guide-en.html") },
  { locale: "ko", path: join(root, "public", "customer-guide-ko.html") },
];
const logo = readFileSync(join(root, "public", "brand", "vision-logo.svg")).toString("base64");

const images = Object.fromEntries([
  "01-login",
  "02-signup",
  "03-password-recovery",
  "04-home",
  "05-meeting-summary",
  "06-transcript",
  "07-global-meeting",
  "08-glossary",
  "10-mobile-home",
].map((name) => [name, readFileSync(join(imageRoot, `${name}.jpg`)).toString("base64")]));

function shot(name, alt, caption) {
  return `<figure class="shot">
    <button class="shot-button" type="button" data-lightbox aria-label="${alt} 크게 보기">
      <img src="data:image/jpeg;base64,${images[name]}" alt="${alt}" loading="lazy">
    </button>
    <figcaption>${caption}</figcaption>
  </figure>`;
}

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Vision AI 미팅 에이전트 · 고객 사용 가이드와 제품 소개</title>
  <style>
    :root {
      --bg: #f7f6f2;
      --paper: #fff;
      --ink: #171916;
      --muted: #626861;
      --line: #dfe4dd;
      --green: #067d62;
      --green-dark: #075b49;
      --mint: #eaf6f0;
      --mint-2: #f1faf6;
      --warm: #f4efe8;
      --warn: #8a5a12;
      --warn-bg: #fff6df;
      --shadow: 0 18px 45px rgba(25, 42, 35, .09);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
      word-break: keep-all;
      overflow-wrap: break-word;
      line-height: 1.7;
    }
    a { color: inherit; }
    img { max-width: 100%; }
    .skip {
      position: fixed; left: 18px; top: -80px; z-index: 100;
      padding: 11px 15px; background: var(--ink); color: #fff; border-radius: 10px;
    }
    .skip:focus { top: 18px; }
    .topbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; justify-content: space-between; gap: 18px;
      min-height: 68px; padding: 10px max(24px, calc((100vw - 1280px) / 2));
      background: rgba(247, 246, 242, .96); border-bottom: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; text-decoration: none; }
    .brand img { width: 94px; height: auto; }
    .brand-copy { display: grid; line-height: 1.25; }
    .brand-copy strong { font-size: 13px; }
    .brand-copy span { color: var(--muted); font-size: 11px; }
    .top-actions { display: flex; align-items: center; gap: 9px; }
    .guide-languages {
      display: inline-flex; align-items: center; gap: 3px; padding: 3px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--paper);
    }
    .guide-languages a {
      display: inline-flex; min-height: 34px; align-items: center; padding: 5px 11px;
      border-radius: 999px; color: var(--muted); font-size: 12px; font-weight: 750;
      text-decoration: none; white-space: nowrap;
    }
    .guide-languages a[aria-current="page"] { background: var(--green); color: #fff; }
    .button {
      display: inline-flex; min-height: 42px; align-items: center; justify-content: center;
      padding: 8px 17px; border: 1px solid var(--line); border-radius: 999px;
      background: var(--paper); color: var(--green-dark); font-weight: 750; font-size: 13px;
      text-decoration: none; cursor: pointer;
    }
    .button.primary { background: var(--green); border-color: var(--green); color: #fff; }
    .layout { display: grid; grid-template-columns: 238px minmax(0, 1fr); max-width: 1280px; margin: 0 auto; }
    .toc {
      position: sticky; top: 69px; align-self: start; height: calc(100vh - 69px);
      padding: 30px 22px 30px 12px; overflow: auto; border-right: 1px solid var(--line);
    }
    .toc p { margin: 0 0 12px; color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .14em; }
    .toc nav { display: grid; gap: 3px; }
    .toc a { padding: 7px 10px; border-radius: 9px; color: var(--muted); font-size: 13px; text-decoration: none; }
    .toc a:hover, .toc a:focus { background: var(--mint); color: var(--green-dark); outline: none; }
    main { min-width: 0; padding: 0 0 100px; }
    .hero { padding: 86px 52px 70px; border-bottom: 1px solid var(--line); }
    .eyebrow { margin: 0 0 15px; color: var(--green); font-size: 12px; font-weight: 850; letter-spacing: .15em; }
    h1, h2, h3, p { text-wrap: pretty; }
    h1 { max-width: 850px; margin: 0; font-size: clamp(38px, 5.1vw, 68px); line-height: 1.1; letter-spacing: -.045em; }
    .hero-lead { max-width: 800px; margin: 25px 0 0; color: var(--muted); font-size: clamp(17px, 2vw, 22px); line-height: 1.65; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
    .hero-meta { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 34px; }
    .chip { padding: 7px 11px; background: var(--mint); border: 1px solid #d1e9dd; border-radius: 999px; color: var(--green-dark); font-size: 12px; font-weight: 750; }
    section.content { padding: 74px 52px 0; scroll-margin-top: 85px; }
    .section-head { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 30px; margin-bottom: 34px; }
    .section-num { color: var(--green); font-size: 12px; font-weight: 850; letter-spacing: .14em; }
    h2 { margin: 0; font-size: clamp(29px, 3.2vw, 43px); line-height: 1.18; letter-spacing: -.035em; }
    h3 { margin: 0; font-size: 21px; line-height: 1.35; letter-spacing: -.015em; }
    .section-lead { max-width: 760px; margin: 13px 0 0; color: var(--muted); font-size: 16px; }
    .value-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .value {
      min-height: 198px; padding: 26px; background: var(--paper); border: 1px solid var(--line); border-radius: 20px;
    }
    .value:nth-child(2), .value:nth-child(5) { background: var(--mint-2); }
    .value-tag { display: inline-flex; margin-bottom: 24px; color: var(--green); font-size: 12px; font-weight: 850; letter-spacing: .1em; }
    .value p { margin: 12px 0 0; color: var(--muted); font-size: 14px; }
    .quote {
      margin: 28px 0 0; padding: 28px 30px; background: var(--ink); color: #fff;
      border-radius: 9px 28px 28px 28px; font-size: clamp(20px, 2.6vw, 30px); font-weight: 750; line-height: 1.5;
    }
    .flow { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; counter-reset: flow; }
    .flow article { position: relative; min-height: 185px; padding: 22px 18px; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; }
    .flow article::before {
      counter-increment: flow; content: "0" counter(flow); display: block; margin-bottom: 32px;
      color: var(--green); font-size: 12px; font-weight: 850; letter-spacing: .13em;
    }
    .flow h3 { font-size: 16px; }
    .flow p { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.65; }
    .callout { margin-top: 22px; padding: 20px 22px; border-left: 4px solid var(--green); background: var(--mint); color: var(--green-dark); }
    .gallery-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
    .shot { margin: 0; min-width: 0; }
    .shot-button { display: block; width: 100%; padding: 0; border: 1px solid var(--line); background: var(--paper); cursor: zoom-in; box-shadow: var(--shadow); }
    .shot-button, .shot-button img { border-radius: 18px; }
    .shot-button img { display: block; width: 100%; height: auto; }
    .shot figcaption { margin-top: 10px; color: var(--muted); font-size: 12px; line-height: 1.55; }
    .feature { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.45fr); gap: 36px; align-items: start; padding: 36px 0; border-top: 1px solid var(--line); }
    .feature:first-of-type { border-top: 0; }
    .feature-copy { position: sticky; top: 94px; }
    .feature-kicker { margin: 0 0 9px; color: var(--green); font-size: 12px; font-weight: 850; }
    .feature-copy p { margin: 13px 0 0; color: var(--muted); font-size: 14px; }
    .feature-copy ul, .check-list { margin: 18px 0 0; padding: 0; list-style: none; }
    .feature-copy li, .check-list li { position: relative; margin: 9px 0; padding-left: 22px; color: #3f453f; font-size: 14px; }
    .feature-copy li::before, .check-list li::before { content: "✓"; position: absolute; left: 0; color: var(--green); font-weight: 900; }
    .feature-wide { grid-column: 1 / -1; }
    .matrix-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); }
    table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 15px 17px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: var(--mint-2); color: var(--green-dark); font-size: 12px; }
    tr:last-child td { border-bottom: 0; }
    td:first-child { width: 19%; font-weight: 800; }
    .step-list { display: grid; gap: 12px; counter-reset: steps; }
    .step { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 18px; padding: 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 15px; }
    .step::before { counter-increment: steps; content: counter(steps); display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--ink); color: #fff; font-weight: 850; }
    .step p { margin: 7px 0 0; color: var(--muted); font-size: 14px; }
    .security-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .security { padding: 23px; background: var(--paper); border: 1px solid var(--line); border-radius: 14px 14px 28px 14px; }
    .security p { margin: 10px 0 0; color: var(--muted); font-size: 13px; }
    .sales-script { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .script-card { padding: 28px; background: var(--paper); border: 1px solid var(--line); border-radius: 22px; }
    .script-card.full { grid-column: 1 / -1; background: var(--mint-2); }
    .script-card blockquote { margin: 18px 0 0; font-size: 17px; font-weight: 700; line-height: 1.75; }
    .script-card ol { margin: 17px 0 0; padding-left: 20px; }
    .script-card li { margin: 8px 0; color: var(--muted); font-size: 14px; }
    .custom {
      display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, .8fr); gap: 22px;
      padding: 34px; background: var(--green-dark); color: #fff; border-radius: 28px 9px 28px 28px;
    }
    .custom p { margin: 13px 0 0; color: #dcebe5; }
    .custom ul { margin: 0; padding: 0; list-style: none; }
    .custom li { margin: 8px 0; padding: 10px 13px; border: 1px solid rgba(255,255,255,.2); border-radius: 10px; font-size: 13px; }
    .faq { display: grid; gap: 10px; }
    details { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; }
    summary { padding: 19px 22px; cursor: pointer; font-weight: 800; }
    details p { margin: 0; padding: 0 22px 20px; color: var(--muted); font-size: 14px; }
    .notice { padding: 22px; border: 1px solid #ebd39e; background: var(--warn-bg); color: #5f451b; border-radius: 14px; }
    .notice h3 { color: var(--warn); font-size: 17px; }
    .notice p { margin: 8px 0 0; font-size: 13px; }
    .cta { margin: 78px 52px 0; padding: 44px; background: var(--ink); color: #fff; border-radius: 32px 10px 32px 32px; }
    .cta h2 { max-width: 720px; }
    .cta p { max-width: 720px; margin: 16px 0 0; color: #cbd0cb; }
    .cta .button { margin-top: 25px; border-color: #fff; }
    footer { padding: 45px 52px 0; color: var(--muted); font-size: 12px; }
    .url { overflow-wrap: anywhere; word-break: break-all; }
    dialog#lightbox {
      width: min(96vw, 1500px); max-width: none; padding: 14px; border: 0; border-radius: 18px; background: #fff;
      box-shadow: 0 30px 90px rgba(0,0,0,.28);
    }
    dialog#lightbox::backdrop { background: rgba(14,18,16,.8); }
    #lightbox img { display: block; width: 100%; max-height: 86vh; object-fit: contain; border-radius: 10px; }
    .lightbox-close { position: absolute; right: 23px; top: 23px; width: 42px; height: 42px; border: 0; border-radius: 50%; background: var(--ink); color: #fff; font-size: 23px; cursor: pointer; }
    @media (max-width: 980px) {
      .layout { display: block; }
      .toc { display: none; }
      .hero, section.content { padding-left: 26px; padding-right: 26px; }
      .flow { grid-template-columns: repeat(2, 1fr); }
      .feature { grid-template-columns: 1fr; }
      .feature-copy { position: static; }
      .security-grid { grid-template-columns: 1fr 1fr; }
      .cta { margin-left: 26px; margin-right: 26px; }
    }
    @media (max-width: 680px) {
      .topbar { padding: 9px 14px; }
      .topbar { align-items: flex-start; flex-wrap: wrap; }
      .top-actions { width: 100%; flex-wrap: wrap; }
      .brand-copy { display: none; }
      .top-actions .button:not(.primary) { display: none; }
      .hero { padding: 56px 20px 48px; }
      section.content { padding: 56px 20px 0; }
      .section-head { grid-template-columns: 1fr; gap: 8px; }
      .value-grid, .gallery-3, .flow, .security-grid, .sales-script, .custom { grid-template-columns: 1fr; }
      .script-card.full { grid-column: auto; }
      .feature { gap: 20px; }
      .cta { margin: 58px 20px 0; padding: 30px 23px; }
      footer { padding-left: 20px; padding-right: 20px; }
    }
    @media print {
      @page { size: A4; margin: 14mm; }
      body { background: #fff; font-size: 10pt; }
      .topbar, .toc, .hero-actions, .lightbox-close { display: none !important; }
      .layout { display: block; max-width: none; }
      main { padding: 0; }
      .hero, section.content { padding: 15mm 0 0; border: 0; }
      .hero { padding-top: 0; }
      h1 { font-size: 30pt; }
      h2 { font-size: 21pt; }
      .value, .flow article, .step, .security, .script-card, .shot { break-inside: avoid; }
      .feature { display: block; break-before: page; }
      .feature-copy { margin-bottom: 8mm; }
      .shot-button { box-shadow: none; }
      .cta { margin: 15mm 0 0; }
      a { text-decoration: none; }
    }
  </style>
</head>
<body>
  <a class="skip" href="#main">본문으로 이동</a>
  <header class="topbar">
    <a class="brand" href="#top" aria-label="문서 처음으로">
      <img src="data:image/svg+xml;base64,${logo}" alt="Vision">
      <span class="brand-copy"><strong>AI Meeting Agent</strong><span>고객 사용 가이드 · 제품 소개</span></span>
    </a>
    <div class="top-actions">
      <!-- GUIDE_LANGUAGE_SWITCHER -->
      <button class="button" type="button" onclick="window.print()">PDF로 저장</button>
      <a class="button primary" href="/login">데모 접속</a>
    </div>
  </header>

  <div class="layout" id="top">
    <aside class="toc" aria-label="목차">
      <p>CONTENTS</p>
      <nav>
        <a href="#overview">제품 한눈에 보기</a>
        <a href="#value">고객이 얻는 가치</a>
        <a href="#flow">작동 방식</a>
        <a href="#access">가입과 로그인</a>
        <a href="#features">주요 기능</a>
        <a href="#manual">사용 방법</a>
        <a href="#feature-matrix">기능 목록</a>
        <a href="#admin">운영과 보안</a>
        <a href="#custom">빠른 맞춤 개발</a>
        <a href="#sales">영업 설명 가이드</a>
        <a href="#faq">자주 묻는 질문</a>
      </nav>
    </aside>

    <main id="main">
      <div class="hero" id="overview">
        <p class="eyebrow">VISION AI MEETING AGENT</p>
        <h1>회의를 놓치지 않고,<br>결정과 실행으로 연결합니다.</h1>
        <p class="hero-lead">회의 녹음부터 다국어 전사, 회의록 요약, 수정, 내보내기까지 하나의 흐름으로 이어지는 업무용 AI 미팅 에이전트입니다. 회의가 끝난 뒤 기록을 다시 만드는 시간을 줄이고, 중요한 결정과 할 일을 더 빠르게 공유할 수 있습니다.</p>
        <div class="hero-actions">
          <a class="button primary" href="/login">현재 테스트 화면 열기</a>
          <a class="button" href="#manual">사용 방법 보기</a>
          <a class="button" href="#sales">영업 설명 문구 보기</a>
        </div>
        <div class="hero-meta" aria-label="핵심 기능">
          <span class="chip">다국어·화자 구분 전사</span>
          <span class="chip">업무 맞춤 AI 회의록</span>
          <span class="chip">화자 분리와 실시간 번역</span>
          <span class="chip">승인형 고객 계정</span>
          <span class="chip">웹·모바일 대응</span>
        </div>
      </div>

      <section class="content" id="value">
        <div class="section-head">
          <div class="section-num">01 · VALUE</div>
          <div><h2>고객이 체감하는 핵심 가치</h2><p class="section-lead">단순히 음성을 글자로 바꾸는 도구가 아닙니다. 회의 전후의 반복 업무를 하나의 제품 안에서 연결해 팀이 실제 행동에 집중하도록 돕습니다.</p></div>
        </div>
        <div class="value-grid">
          <article class="value"><span class="value-tag">RECORD ONCE</span><h3>한 번 녹음하면 기록 흐름이 이어집니다</h3><p>원본 오디오를 보관하고, 녹음 종료 후 전사와 회의록 생성으로 이어집니다. 메모하느라 대화에 집중하지 못하는 상황을 줄입니다.</p></article>
          <article class="value"><span class="value-tag">SHARE FASTER</span><h3>회의 결과를 더 빠르게 공유합니다</h3><p>긴 대화에서 핵심 논의, 결정사항, 할 일을 정리하고 Markdown과 JSON으로 내보낼 수 있어 후속 공유가 간결해집니다.</p></article>
          <article class="value"><span class="value-tag">GLOBAL READY</span><h3>언어가 달라도 같은 회의에 참여합니다</h3><p>다국어 인식과 양방향 번역, 번역 음성 송출을 지원해 해외 고객·파트너와의 회의 장벽을 낮춥니다.</p></article>
          <article class="value"><span class="value-tag">CONTROL</span><h3>사람이 마지막 품질을 통제합니다</h3><p>전체 스크립트와 회의록 요약을 각각 직접 수정할 수 있습니다. 수정 뒤 필요한 부분만 독립적으로 다시 생성할 수 있습니다.</p></article>
          <article class="value"><span class="value-tag">DOMAIN FIT</span><h3>회사 용어에 맞게 정확도를 높입니다</h3><p>제품명, 인명, 전문 용어와 자주 틀리는 표현을 단어장에 등록해 교정 단계에 반영할 수 있습니다.</p></article>
          <article class="value"><span class="value-tag">RIGHT FIT</span><h3>업무에 필요한 품질을 효율적으로 제공합니다</h3><p>교정, 번역, 요약과 질문의 목적에 맞춰 처리 방식을 조절해 읽기 좋은 결과를 안정적으로 제공합니다.</p></article>
        </div>
        <div class="quote">“회의가 끝난 순간부터, 다시 듣고 정리하는 일이 아니라 결정하고 실행하는 일이 시작됩니다.”</div>
      </section>

      <section class="content" id="flow">
        <div class="section-head">
          <div class="section-num">02 · FLOW</div>
          <div><h2>녹음부터 회의록까지 한 번에</h2><p class="section-lead">업무 흐름은 단순합니다. 사용자는 녹음을 시작하고 결과를 검토하면 됩니다.</p></div>
        </div>
        <div class="flow">
          <article><h3>회의 녹음</h3><p>브라우저 마이크로 원본 오디오를 기록합니다.</p></article>
          <article><h3>다국어 전사</h3><p>언어 인식, 화자 구분과 타임스탬프가 포함된 전사를 만듭니다.</p></article>
          <article><h3>문맥 교정</h3><p>회사 단어장과 회의 문맥을 반영해 읽기 좋은 스크립트를 만듭니다.</p></article>
          <article><h3>회의록 요약</h3><p>핵심 논의, 결정과 할 일을 구조화합니다.</p></article>
          <article><h3>검토와 공유</h3><p>사람이 수정한 뒤 복사하거나 파일로 내보냅니다.</p></article>
        </div>
        <div class="callout">원본 오디오와 최초 전사 결과는 보존하고, 사용자가 수정하거나 다시 생성하는 결과물은 별도로 관리합니다. 잘못된 수정이나 재생성으로 원본이 사라지지 않도록 설계되어 있습니다.</div>
      </section>

      <section class="content" id="access">
        <div class="section-head">
          <div class="section-num">03 · ACCESS</div>
          <div><h2>고객사 승인형 계정으로 안전하게 시작</h2><p class="section-lead">아무나 가입 즉시 사용할 수 있는 구조가 아닙니다. 고객이 사용 신청을 보내면 운영자가 계약과 결제 상태를 확인한 뒤 계정을 활성화합니다.</p></div>
        </div>
        <div class="gallery-3">
          ${shot("01-login", "일본어, 영어, 한국어 전환이 가능한 고객 로그인 화면", "로그인 화면에서 日本語·English·한국어를 바로 전환할 수 있습니다.")}
          ${shot("02-signup", "회사명과 담당자, 요금제를 입력하는 회원가입 신청 화면", "신청 즉시 접근되는 방식이 아니라 운영자 승인과 결제 확인 뒤 활성화됩니다.")}
          ${shot("03-password-recovery", "가입 이메일로 임시 비밀번호를 요청하는 화면", "가입 이메일로 30분 유효·1회용 임시 비밀번호를 받고, 로그인 후 새 비밀번호로 변경합니다.")}
        </div>
        <div class="step-list" style="margin-top:28px">
          <article class="step"><div><h3>고객이 사용 신청</h3><p>회사명, 담당자 이름, 업무 이메일, 비밀번호와 희망 요금제를 입력합니다. 현재 신청 화면은 월 1,500엔 또는 월 9.9달러 선택지를 제공하며, 실제 계약 조건은 별도 협의할 수 있습니다.</p></div></article>
          <article class="step"><div><h3>운영자가 계약과 결제 확인</h3><p>운영자 화면에서 신청 계정을 확인하고 승인·결제 완료 상태로 변경합니다. 미결제, 연체 또는 차단 상태에서는 고객 접근을 막을 수 있습니다.</p></div></article>
          <article class="step"><div><h3>승인된 고객만 제품 사용</h3><p>로그인할 때마다 계정 상태를 확인합니다. 접근 상태가 변경되면 기존 고객 세션도 무효화됩니다.</p></div></article>
        </div>
      </section>

      <section class="content" id="features">
        <div class="section-head">
          <div class="section-num">04 · FEATURES</div>
          <div><h2>매일 쓰는 주요 화면과 기능</h2><p class="section-lead">아래 화면은 실제 사용자 데이터가 아닌 영업 설명용 합성 데모 데이터로 촬영했습니다. 제품 구성과 조작 방식은 현재 구현 화면을 그대로 사용했습니다.</p></div>
        </div>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">HOME</p><h3>필요한 도구와 최근 회의를 한곳에</h3><p>로그인하면 새 랜딩 페이지가 아니라 실제 업무 홈이 열립니다. 회의 녹음, 미팅노트, 글로벌 미팅 번역, 음성 입력을 바로 시작하고 최근 회의록을 확인합니다.</p><ul><li>워크스페이스와 폴더별 회의 정리</li><li>최근 작업한 문서 빠른 접근</li><li>언어와 화면 모드 전환</li><li>모바일·좁은 화면 대응</li></ul></div>
          ${shot("04-home", "새 회의 녹음과 최근 회의 목록이 보이는 데스크톱 홈 화면", "모든 기능이 준비된 데모 상태입니다. ‘일본 고객사 파일럿 준비 회의’는 합성 데이터입니다.")}
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">SUMMARY</p><h3>읽기 쉬운 회의록으로 핵심만 확인</h3><p>회의 목적, 핵심 논의, 결정사항과 할 일을 한 화면에서 검토합니다. 참석자는 사람이 직접 확정하며, 요약을 복사하거나 JSON·Markdown 파일로 내보낼 수 있습니다.</p><ul><li>참석자 직접 관리</li><li>요약 복사와 JSON 다운로드</li><li>회의록 Markdown 다운로드</li><li>현재 스크립트만 기준으로 요약 재생성</li></ul></div>
          ${shot("05-meeting-summary", "일본 고객사 파일럿 준비 회의의 회의록 요약 화면", "회의 제목, 참석자, 작업 버튼과 요약 본문이 분리되어 있어 검토 흐름이 명확합니다.")}
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">TRANSCRIPT</p><h3>전체 스크립트도 사람이 직접 다듬습니다</h3><p>자동 전사·교정 결과를 전체 스크립트 탭에서 확인하고 수정할 수 있습니다. 스크립트를 바꾸면 기존 요약을 삭제하지 않고 ‘요약 갱신 필요’ 상태로 알려 줍니다.</p><ul><li>전체 스크립트 복사와 직접 수정</li><li>원문에서 스크립트만 다시 만들기</li><li>스크립트·요약 독립 재생성</li><li>저장하지 않은 수정 내용 이탈 보호</li></ul></div>
          ${shot("06-transcript", "화자별 전체 스크립트와 수정·재생성 버튼이 보이는 화면", "전사 결과를 회의 맥락에 맞게 검토하고 필요할 때만 다시 만들 수 있습니다.")}
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">GLOBAL MEETING</p><h3>해외 회의를 위한 실시간 양방향 번역</h3><p>참석자를 미리 등록하지 않아도 화자를 자동 구분하고, 말하는 언어를 인식해 선택한 내 언어로 보여 줍니다. Push-to-Talk 구간은 번역 음성으로 상대방에게 송출할 수 있습니다.</p><ul><li>내 언어와 상대방 언어 선택</li><li>화자 자동 구분과 대화 기록</li><li>번역 음성·속도 선택</li><li>회의 종료 뒤 회의록 저장</li></ul></div>
          ${shot("07-global-meeting", "한국어와 영어 양방향 글로벌 미팅 번역 화면", "글로벌 영업, 해외 파트너 미팅과 다국적 내부 회의에 활용할 수 있습니다.")}
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">INTERPRETER ROOM</p><h3>각자 자기 화면에서 보는 통역 회의실</h3><p>링크와 비밀번호로 상대방을 초대하면 두 사람이 각자 자기 기기에서 같은 대화를 자기 언어로 봅니다. 내가 한 말이 상대에게 어떻게 전달됐는지 확인하고, 상대의 말은 내 언어로 읽습니다. 음성은 화상회의나 같은 방에서 그대로 주고받습니다.</p><ul><li>초대 링크와 비밀번호 한 번에 복사</li><li>문장이 끝나면 바로 양쪽 화면에 원문과 번역 표시</li><li>이어폰을 끼면 상대 말이 끝난 뒤 내 언어 음성으로 듣기</li><li>화상회의 모드와 같은 방 모드</li><li>회의 종료 뒤 24시간 동안 상대도 회의록을 원하는 언어로 내려받기</li></ul></div>
          <figure class="shot">
    <figcaption>상대방은 계정 없이 이름과 비밀번호만으로 입장하며, 회의록은 Word·PDF·Markdown으로 받을 수 있습니다.</figcaption>
  </figure>
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">GLOSSARY</p><h3>회사 고유 용어를 계속 축적</h3><p>제품명, 프로젝트명, 고객명과 전문 용어를 일반 용어로 등록합니다. 자주 잘못 인식되는 표현은 ‘잘못 인식된 표기 → 올바른 표기’ 교정쌍으로 관리합니다.</p><ul><li>여러 용어 한 번에 추가</li><li>오인식 교정쌍 관리</li><li>새 회의 교정 단계 자동 반영</li><li>기존 회의는 필요할 때만 재교정</li></ul></div>
          ${shot("08-glossary", "일반 용어와 교정쌍을 관리하는 단어 관리 화면", "단어장은 자동 전사 원문을 바꾸지 않고, 읽기 좋은 스크립트 교정 과정에 활용됩니다.")}
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">SETTINGS</p><h3>개인별로 편안한 사용 환경</h3><p>화면 글자 크기, 표시 이름과 시간대 같은 개인 설정을 간단하게 관리합니다.</p><ul><li>표시 이름과 별칭 관리</li><li>시간대와 주 시작 요일 설정</li><li>글자 크기·언어·화면 모드</li><li>고객 화면에는 운영 설정을 노출하지 않음</li></ul></div>
          <div class="callout"><h3>기능에 집중하는 설정 화면</h3><p>고객은 사용에 필요한 개인 설정만 확인합니다. 서비스 운영 방식과 내부 연동 정보는 고객 화면에 표시하지 않습니다.</p></div>
        </article>

        <article class="feature">
          <div class="feature-copy"><p class="feature-kicker">MOBILE</p><h3>이동 중에도 핵심 기능을 자연스럽게</h3><p>좁은 모바일 화면에서는 탐색 메뉴를 접고, 녹음과 주요 기능을 한 열로 재배치합니다. Android 앱은 고객 로그인과 비밀번호 찾기, AI 노트 사용 흐름을 제공합니다.</p><ul><li>390px 모바일 화면 대응</li><li>터치하기 쉬운 큰 작업 버튼</li><li>고객 기능 중심의 간결한 앱 화면</li><li>필요 인원에게 APK 직접 배포 가능</li></ul></div>
          ${shot("10-mobile-home", "모바일 화면에서 한 열로 재배치된 AI 노트 홈", "데스크톱과 같은 핵심 기능을 모바일 화면 크기에 맞게 재배치합니다.")}
        </article>
      </section>

      <section class="content" id="manual">
        <div class="section-head">
          <div class="section-num">05 · MANUAL</div>
          <div><h2>고객 사용자용 빠른 시작</h2><p class="section-lead">처음 사용하는 고객이 아래 순서대로 진행하면 됩니다.</p></div>
        </div>
        <div class="step-list">
          <article class="step"><div><h3>승인된 이메일로 로그인합니다</h3><p>로그인 화면에서 일본어, 영어, 한국어를 선택한 뒤 이메일과 비밀번호를 입력합니다. 비밀번호를 잊었다면 ‘비밀번호를 잊으셨나요?’를 선택합니다.</p></div></article>
          <article class="step"><div><h3>회의를 저장할 위치를 선택합니다</h3><p>워크스페이스와 폴더를 정리해 두면 회의가 끝난 뒤 결과를 찾기 쉽습니다. 별도 선택이 없으면 현재 워크스페이스의 미분류 위치에 저장됩니다.</p></div></article>
          <article class="step"><div><h3>녹음할 소리를 선택하고 시작합니다</h3><p>대면 회의는 ‘마이크만’을 선택합니다. Zoom이나 Google Meet 회의는 데스크톱 Chrome에서 ‘마이크와 회의 소리’를 선택한 뒤 공유 창에서 회의 탭과 오디오 공유를 켭니다. 타이머와 입력 레벨로 녹음 상태를 확인합니다.</p></div></article>
          <article class="step"><div><h3>전사와 요약이 완료될 때까지 기다립니다</h3><p>녹음이 끝나면 다국어·화자 구분 전사와 AI 회의록 작성이 순서대로 진행됩니다. 상태는 회의 목록과 상세 화면에서 확인할 수 있습니다.</p></div></article>
          <article class="step"><div><h3>전체 스크립트를 검토합니다</h3><p>고유명사, 수치, 일정과 담당자가 정확한지 확인합니다. 반복해서 틀리는 표현은 단어 관리에 등록하면 다음 회의부터 교정 품질을 높일 수 있습니다.</p></div></article>
          <article class="step"><div><h3>회의록 요약을 확인하고 공유합니다</h3><p>결정사항과 할 일을 최종 확인한 뒤 요약 복사, JSON 다운로드 또는 회의록 다운로드를 사용합니다. 공식 문서로 배포하기 전에는 반드시 사람이 최종 검토합니다.</p></div></article>
        </div>
      </section>

      <section class="content" id="feature-matrix">
        <div class="section-head">
          <div class="section-num">06 · MATRIX</div>
          <div><h2>기능 전체 목록</h2><p class="section-lead">고객 미팅에서 필요한 기능을 영역별로 빠르게 설명할 수 있도록 정리했습니다.</p></div>
        </div>
        <div class="matrix-wrap">
          <table>
            <thead><tr><th>영역</th><th>주요 기능</th><th>고객 가치</th><th>운영 시 참고</th></tr></thead>
            <tbody>
              <tr><td>계정</td><td>가입 신청, 운영자 승인, 결제 상태, 접근 차단</td><td>계약 고객만 안전하게 사용</td><td>미결제·연체·차단 시 세션 무효화</td></tr>
              <tr><td>로그인</td><td>일본어·영어·한국어, 비밀번호 복구</td><td>일본 고객사도 쉽게 시작</td><td>임시 비밀번호 30분·1회용</td></tr>
              <tr><td>녹음</td><td>마이크, 공유한 회의 소리, 타이머, 입력 레벨, 원본 저장</td><td>대면·온라인 회의에 집중하면서 기록 확보</td><td>회의 소리 녹음은 데스크톱 Chrome 권장</td></tr>
              <tr><td>전사</td><td>녹음 후 전사·실시간 전사, 언어 인식, 화자 구분</td><td>다국어 회의를 읽을 수 있는 기록으로 전환</td><td>오디오는 기능 제공 범위에서 처리</td></tr>
              <tr><td>AI 회의록</td><td>문맥 교정, 회의록 요약, 번역과 질문</td><td>긴 회의를 결정과 할 일 중심으로 정리</td><td>필요한 텍스트 문맥을 기능 제공 범위에서 처리</td></tr>
              <tr><td>회의 상세</td><td>스크립트·요약 2탭, 직접 수정, 독립 재생성</td><td>사람이 최종 결과를 통제</td><td>스크립트 변경 뒤 요약 최신성 안내</td></tr>
              <tr><td>공유</td><td>복사, JSON, Markdown 회의록 다운로드</td><td>보고·보관·후속 도구 연결 용이</td><td>공유 전 수치와 결정사항 검토 권장</td></tr>
              <tr><td>조직화</td><td>워크스페이스, 최대 3단계 폴더, 이동과 검색</td><td>프로젝트·고객별 회의 정리</td><td>승인 계정별 데이터 공간 분리</td></tr>
              <tr><td>단어장</td><td>일반 용어와 오인식 교정쌍</td><td>도메인 용어 정확도 개선</td><td>기존 회의는 사용자가 재교정 선택</td></tr>
              <tr><td>글로벌 미팅</td><td>양방향 번역, Push-to-Talk 번역 음성</td><td>해외 영업과 파트너 회의 지원</td><td>인터넷 연결 필요</td></tr>
              <tr><td>통역 회의실</td><td>초대 링크·비밀번호, 참가자별 언어 화면, 실시간 번역, 통역 음성 듣기, 회의록 다운로드</td><td>상대방과 각자 화면으로 같은 회의 진행</td><td>상대 링크는 회의 종료 뒤 24시간 유효</td></tr>
              <tr><td>운영</td><td>계정별 사용량 확인, 운영자 초대, 감사 기록</td><td>고객 상태와 사용 현황을 한곳에서 관리</td><td>자동 결제 수납은 현재 범위에 포함되지 않음</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="content" id="admin">
        <div class="section-head">
          <div class="section-num">07 · ADMIN</div>
          <div><h2>운영자 관리와 보안 원칙</h2><p class="section-lead">고객 접근은 승인과 결제 상태를 기준으로 통제하고, 운영자 계정은 고객 계정보다 강한 인증 흐름을 사용합니다.</p></div>
        </div>
        <div class="security-grid">
          <article class="security"><h3>승인형 가입</h3><p>사용 신청만으로 제품에 들어갈 수 없습니다. 운영자가 고객사와 결제 상태를 확인한 뒤 활성화합니다.</p></article>
          <article class="security"><h3>운영자 2단계 인증</h3><p>운영자 로그인은 비밀번호와 TOTP 인증 앱의 6자리 코드를 함께 사용하고, 일회용 복구 코드를 별도로 제공합니다.</p></article>
          <article class="security"><h3>운영자 초대</h3><p>추가 운영자는 24시간 유효한 일회용 초대 링크로 발급해 임의의 공개 회원가입을 막습니다.</p></article>
          <article class="security"><h3>비밀번호 복구</h3><p>고객은 가입 이메일로 임시 비밀번호를 받습니다. 계정 존재 여부는 화면 응답으로 노출하지 않습니다.</p></article>
          <article class="security"><h3>운영 정보 비공개</h3><p>외부 연동 정보와 서비스 운영 설정은 고객 화면에 표시하지 않습니다.</p></article>
          <article class="security"><h3>필요 범위 내 처리</h3><p>기능 제공에 필요한 음성과 텍스트만 처리하고, 고객의 업무 결과는 승인된 계정에서 확인하도록 관리합니다.</p></article>
        </div>
        <div class="notice" style="margin-top:22px"><h3>데이터 처리 안내</h3><p>회의 오디오와 교정·요약·질문·번역에 필요한 텍스트는 기능 제공을 위해 외부 처리 서비스로 전송될 수 있습니다. 회의에는 개인정보와 영업 정보가 포함될 수 있으므로 고객사의 보안 정책과 이용 동의를 확인해야 합니다.</p></div>
      </section>

      <section class="content" id="custom">
        <div class="section-head">
          <div class="section-num">08 · CUSTOM</div>
          <div><h2>원하는 기능을 더 빠르게 맞춰 드립니다</h2><p class="section-lead">녹음, 전사, AI 회의록, 계정과 운영 기능이 이미 준비되어 있어 고객사의 우선순위에 따라 필요한 기능을 단계적으로 확장하기 좋습니다.</p></div>
        </div>
        <div class="custom">
          <div><h3>처음부터 다시 만드는 프로젝트가 아닙니다</h3><p>이미 작동하는 제품을 기준으로 고객사의 실제 업무 흐름, 문서 형식과 연동 요구를 확인해 필요한 부분부터 빠르게 개발할 수 있습니다. 요청 범위와 우선순위를 함께 정하면 작은 개선은 짧은 주기로 확인하고 다음 기능으로 이어갈 수 있습니다.</p><p>정확한 일정은 요구사항 확정 뒤 안내하지만, 고객 피드백을 제품에 신속하게 반영하는 개발 방식 자체가 중요한 장점입니다.</p></div>
          <ul>
            <li>회사 전용 회의록 템플릿과 출력 형식</li>
            <li>CRM·그룹웨어·문서 도구 연동</li>
            <li>특정 산업 용어와 검수 규칙</li>
            <li>권한·조직·결제 정책 고도화</li>
            <li>전용 도메인과 브랜드 적용</li>
            <li>관리 통계와 리포트 확장</li>
          </ul>
        </div>
      </section>

      <section class="content" id="sales">
        <div class="section-head">
          <div class="section-num">09 · SALES</div>
          <div><h2>고객에게 이렇게 설명하세요</h2><p class="section-lead">상담 시간에 맞춰 바로 읽을 수 있는 소개 문구와 데모 순서입니다.</p></div>
        </div>
        <div class="sales-script">
          <article class="script-card"><p class="feature-kicker">10초 소개</p><blockquote>“회의를 녹음하면 다국어 전사와 회의록 정리까지 이어지고, 사람이 마지막으로 수정해서 바로 공유할 수 있는 AI 미팅 에이전트입니다.”</blockquote></article>
          <article class="script-card"><p class="feature-kicker">30초 소개</p><blockquote>“회의 중에는 대화에 집중하고, 끝난 뒤에는 전체 스크립트와 핵심 결정·할 일을 빠르게 확인하세요. 해외 회의는 실시간 양방향 번역을 사용할 수 있고, 회사 용어를 등록해 품질도 계속 개선할 수 있습니다.”</blockquote></article>
          <article class="script-card full"><p class="feature-kicker">약 7분 데모 순서</p><ol><li>로그인 언어 전환과 승인형 계정 구조를 40초 동안 설명합니다.</li><li>홈에서 회의 녹음, 미팅노트, 글로벌 미팅 번역, 음성 입력을 50초 동안 보여 줍니다.</li><li>‘일본 고객사 파일럿 준비 회의’를 열어 참석자와 회의록 요약을 90초 동안 설명합니다.</li><li>전체 스크립트 탭에서 직접 수정과 독립 재생성을 60초 동안 설명합니다.</li><li>글로벌 미팅 번역 화면에서 언어·음성·Push-to-Talk 흐름을 90초 동안 보여 줍니다.</li><li>단어 관리에서 고객사 용어를 반영하는 방법을 40초 동안 설명합니다.</li><li>마지막 30초에는 고객사 전용 기능도 우선순위에 따라 빠르게 추가 개발할 수 있다고 안내합니다.</li></ol></article>
        </div>
      </section>

      <section class="content" id="faq">
        <div class="section-head">
          <div class="section-num">10 · FAQ</div>
          <div><h2>자주 묻는 질문</h2><p class="section-lead">고객 미팅에서 자주 나올 수 있는 질문을 현재 구현 범위에 맞춰 정리했습니다.</p></div>
        </div>
        <div class="faq">
          <details open><summary>인터넷이 없어도 사용할 수 있나요?</summary><p>현재 제품은 실시간 음성 인식과 AI 회의록 기능을 사용하므로 인터넷 연결이 필요합니다. 오프라인 환경은 현재 고려 대상이 아닙니다.</p></details>
          <details><summary>Zoom이나 Google Meet의 회의 소리도 녹음할 수 있나요?</summary><p>가능합니다. 녹음 화면에서 ‘마이크와 회의 소리’를 선택하고, 데스크톱 Chrome의 공유 창에서 회의 탭과 오디오 공유를 켜면 내 마이크와 상대방 소리를 함께 기록합니다. Google Meet처럼 브라우저 탭에서 진행하는 회의가 가장 안정적이며, Zoom 데스크톱 앱 전체 소리는 운영체제와 브라우저 지원 여부에 따라 제한될 수 있습니다. Android 앱에서는 현재 마이크 녹음을 사용합니다.</p></details>
          <details><summary>유튜브나 브라우저 회의 음성을 더 선명하게 받으려면 어떻게 하나요?</summary><p>글로벌 미팅을 시작하기 전에 입력 소스에서 ‘브라우저 탭 오디오’를 선택하고, Chrome 공유 창에서 재생 중인 영상이나 회의 탭과 오디오 공유를 켭니다. 스피커 소리를 마이크로 다시 받지 않고 탭의 원본 음성을 직접 입력하므로 전사와 화자 구분이 더 안정적입니다. 대면 회의에서는 ‘마이크’를 사용합니다.</p></details>
          <details><summary>서로 다른 유튜브 영상을 연속으로 재생할 때 화자 구분은 어떻게 하나요?</summary><p>영상이나 음원 하나가 끝나고 다른 콘텐츠를 재생하기 전에 글로벌 미팅 화면의 ‘새 영상·음원’을 누릅니다. 지금까지의 대화 기록은 유지하고, 새 콘텐츠의 화자 문맥만 다시 시작해 앞 영상의 목소리 정보가 다음 영상에 섞이지 않도록 합니다. 같은 회의가 계속되는 동안에는 누르지 않아도 됩니다.</p></details>
          <details><summary>AI가 만든 회의록을 그대로 공식 문서로 써도 되나요?</summary><p>AI 결과에는 고유명사, 수치와 문맥 오류가 있을 수 있습니다. 전체 스크립트와 결정사항을 사람이 최종 검토한 뒤 공식 문서로 사용해야 합니다.</p></details>
          <details><summary>회의록을 우리 회사 형식으로 바꿀 수 있나요?</summary><p>가능합니다. 현재 구조화 요약과 자유 본문 편집을 제공하며, 회사 전용 항목·템플릿·내보내기 형식은 요구사항에 따라 추가 개발할 수 있습니다.</p></details>
          <details><summary>사용량 제한이 있나요?</summary><p>기본 사용 정책은 무제한을 전제로 하되, 운영자는 계정별 사용량을 확인할 수 있습니다. 실제 계약의 공정 사용 정책과 가격 조건은 고객사별로 협의할 수 있습니다.</p></details>
          <details><summary>요금은 어떻게 정해지나요?</summary><p>최종 판매 가격과 할인 정책은 Vision이 고객 계약에 맞춰 결정할 수 있습니다. 일일·주간 이용권, 시간형 이용권과 월간 이용권을 조합할 수 있으며, 실제 견적은 이용 인원과 예상 사용량을 확인한 뒤 안내합니다.</p></details>
          <details><summary>여러 고객사가 같은 환경을 함께 써도 되나요?</summary><p>현재 테스트 환경에서도 승인된 계정마다 회의·라이브러리·단어장·개인 설정을 분리합니다. 여러 고객사를 함께 운영하는 상용 단계에서는 회사 단위 권한과 자동 결제·정산 정책을 계약 구조에 맞춰 추가할 수 있습니다.</p></details>
          <details><summary>비밀번호를 잊으면 어떻게 하나요?</summary><p>로그인 화면의 비밀번호 찾기에서 가입 이메일을 입력합니다. 30분 동안 한 번만 사용할 수 있는 임시 비밀번호를 받은 뒤, 로그인 즉시 새 비밀번호로 변경합니다.</p></details>
          <details><summary>데이터는 어떻게 처리되나요?</summary><p>오디오와 교정·요약·질문·번역에 필요한 텍스트는 기능 제공을 위해 외부 처리 서비스로 전송될 수 있습니다. 서비스 운영 설정과 외부 연동 정보는 고객 화면에 표시하지 않습니다.</p></details>
        </div>
      </section>

      <section class="content" id="scope">
        <div class="notice"><h3>현재 고객 테스트 범위</h3><p>현재 배포는 승인된 계정마다 업무 데이터를 분리하는 고객 테스트 환경입니다. 자동 결제 수납, 회사 단위 세분화 권한, 캘린더 연동과 공유 동시 편집은 현재 제품 범위에 포함되지 않습니다. 고객 테스트에서 우선순위를 확인한 뒤 필요한 기능부터 확장할 수 있습니다.</p></div>
      </section>

      <div class="cta">
        <p class="eyebrow" style="color:#78d7b8">START A PILOT</p>
        <h2>고객사의 실제 회의로 가치를 확인해 보세요.</h2>
        <p>짧은 파일럿에서 전사 정확도, 회의록 공유 시간, 해외 회의 활용성과 필요한 맞춤 기능을 함께 확인할 수 있습니다.</p>
        <a class="button primary" href="/login">테스트 화면으로 이동</a>
      </div>

      <footer>
        <p>Vision AI Meeting Agent · 고객 사용 가이드와 제품 소개</p>
        <p>현재 접속 주소의 로그인 화면에서 바로 테스트할 수 있습니다.</p>
        <p>화면 캡처는 실제 고객 데이터가 아닌 합성 데모 데이터로 제작되었습니다. 제품 기능과 화면은 배포 버전에 따라 개선될 수 있습니다.</p>
      </footer>
    </main>
  </div>

  <dialog id="lightbox" aria-label="화면 이미지 크게 보기">
    <button class="lightbox-close" type="button" aria-label="닫기">×</button>
    <img alt="">
  </dialog>
  <script>
    const dialog = document.getElementById('lightbox');
    const dialogImage = dialog.querySelector('img');
    document.querySelectorAll('[data-lightbox]').forEach((button) => {
      button.addEventListener('click', () => {
        const image = button.querySelector('img');
        dialogImage.src = image.src;
        dialogImage.alt = image.alt;
        dialog.showModal();
      });
    });
    dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  </script>
</body>
</html>`;

function writeDurably(outputPath, contents) {
  const directory = dirname(outputPath);
  const tempPath = join(directory, `.customer-guide-${process.pid}-${randomUUID()}.tmp`);
  let fileDescriptor;
  try {
    fileDescriptor = openSync(tempPath, "wx", 0o600);
    writeFileSync(fileDescriptor, contents, "utf8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(tempPath, outputPath);
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
}

for (const output of outputs) {
  writeDurably(output.path, localizeCustomerGuide(html, output.locale));
  console.log(output.path);
}
