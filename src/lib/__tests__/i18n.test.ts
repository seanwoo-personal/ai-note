import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { translateUi, UI_CATALOGS } from "@/lib/i18n";

describe("UI translations", () => {
  it("translates shared shell copy into all supported locales with the exact brand", () => {
    expect(translateUi("ko", "헤이홈 AI 기록도구")).toBe("헤이홈 AI 기록도구");
    expect(translateUi("en", "헤이홈 AI 기록도구")).toBe("Soniox AI Notes");
    expect(translateUi("zh", "헤이홈 AI 기록도구")).toBe("Hejhome AI 记录工具");
    expect(translateUi("ja", "헤이홈 AI 기록도구")).toBe("Hejhome AI記録ツール");
  });

  it("interpolates named values after translation and preserves unknown copy", () => {
    expect(translateUi("en", "{name} 이름 수정", { name: "Research" })).toBe("Rename Research");
    expect(translateUi("zh", "회의 {count}개", { count: 3 })).toBe("3 个会议");
    expect(translateUi("ja", "미등록 문구")).toBe("미등록 문구");
    expect(translateUi("en", "{title} 관리 메뉴", { title: "Roadmap" })).toBe("Roadmap management menu");
    expect(translateUi("zh", "{title} 관리 메뉴", { title: "Roadmap" })).toBe("Roadmap 管理菜单");
    expect(translateUi("ja", "{title} 관리 메뉴", { title: "Roadmap" })).toBe("Roadmap 管理メニュー");
    expect(translateUi("en", "출처 {number}: {title}", { number: 2, title: "설정" })).toBe("Source 2: 설정");
    expect(translateUi("zh", "용어 삭제: {term}", { term: "설정" })).toBe("删除术语：설정");
    expect(translateUi("ja", "교정쌍 삭제: {term}", { term: "설정" })).toBe("修正ペアを削除: 설정");
    expect(translateUi("en", "{label} 단축키: {action}", { label: "Voice Typing", action: "Change" })).toBe("Voice Typing shortcut: Change");
    expect(translateUi("en", "Whisper large-v3 · 준비됨")).toBe("Whisper large-v3 · Ready");
    expect(translateUi("ja", "Codex CLI gpt-5 · 감지됨")).toBe("Codex CLI gpt-5 · 検出済み");
    expect(translateUi("zh", "Claude CLI sonnet 사용 가능")).toBe("Claude CLI sonnet 可用");
    expect(translateUi("en", "{speaker} 대화 행", { speaker: "Speaker 2" })).toBe("Speaker 2 transcript row");
    expect(translateUi("zh", "{speaker} 실시간 대화 행", { speaker: "Speaker 2" })).toBe("Speaker 2 实时对话行");
    expect(translateUi("ja", "{speaker} 대화 행", { speaker: "Speaker 2" })).toBe("Speaker 2 会話行");
  });

  it("translates runtime health status copy in every non-Korean locale", () => {
    expect(translateUi("en", "연결 안 됨")).toBe("Disconnected");
    expect(translateUi("zh", "연결 안 됨")).toBe("未连接");
    expect(translateUi("ja", "연결 안 됨")).toBe("未接続");
    expect(translateUi("en", "요약 모델 미설정")).toBe("Summary model not configured");
    expect(translateUi("zh", "요약 모델 미설정")).toBe("摘要模型未配置");
    expect(translateUi("ja", "요약 모델 미설정")).toBe("要約モデル未設定");
    expect(translateUi("en", "설정 확인 불가")).toBe("Unable to check configuration");
    expect(translateUi("zh", "설정 확인 불가")).toBe("无法检查配置");
    expect(translateUi("ja", "설정 확인 불가")).toBe("設定を確認できません");
    expect(translateUi("en", "Whisper · 연결 안 됨")).toBe("Whisper · Disconnected");
    expect(translateUi("zh", "Whisper · 연결 안 됨")).toBe("Whisper · 未连接");
    expect(translateUi("ja", "Whisper · 연결 안 됨")).toBe("Whisper · 未接続");
    expect(translateUi("en", "외부 모델 · 설정 확인 불가")).toBe("외부 모델 · Unable to check configuration");
    expect(translateUi("zh", "외부 모델 · 설정 확인 불가")).toBe("외부 모델 · 无法检查配置");
    expect(translateUi("ja", "외부 모델 · 설정 확인 불가")).toBe("외부 모델 · 設定を確認できません");
    for (const source of [
      "전사 서버에 연결할 수 없습니다.",
      "요약 모델을 설정해야 회의록 요약을 생성할 수 있습니다.",
      "로컬 설정 확인 요청에 실패해 실시간 전사 설정 여부나 인터넷 상태를 판단할 수 없습니다.",
    ]) {
      for (const locale of ["en", "zh", "ja"] as const) {
        expect(translateUi(locale, source)).not.toMatch(/[가-힣]/);
      }
    }
  });

  it("localizes the split summary-model and realtime system rows in every non-Korean locale", () => {
    // Source of truth: healthStatus.ts formatSummaryModelStatus/formatRealtimeStatus
    // shortLabels + titles rendered by the sidebar SystemRows. A missing catalog
    // entry leaves Korean on screen in en/ja/zh, which the theme-i18n regression rejects.
    const rowStrings = [
      // short labels newly introduced by the row split
      "미설정", "실패", "연결됨", "대기",
      // summary-model titles
      "설정에서 요약 모델을 지정해야 회의록 요약을 만들 수 있습니다.",
      "요약 모델을 사용할 수 없습니다. 설정에서 상태를 확인해 주세요.",
      "요약 모델이 준비되었습니다.",
      // realtime titles
      "실시간 전사·번역에 연결되었습니다.",
      "실시간 전사·번역에 연결하고 있습니다.",
      "실시간 전사·번역 설정 여부를 확인하고 있습니다.",
      "로컬 설정 확인 요청에 실패해 실시간 전사·번역 설정 여부를 판단할 수 없습니다.",
      "실시간 전사·번역 키가 설정되지 않았습니다.",
      "실시간 전사·번역을 사용할 수 있습니다. 미팅을 시작하면 연결됩니다.",
    ];
    for (const source of rowStrings) {
      for (const locale of ["en", "zh", "ja"] as const) {
        expect(translateUi(locale, source), `${locale}: ${source}`).not.toMatch(/[가-힣]/);
      }
    }
  });

  it("localizes every Translator input-language option, including auto-detect, in non-Korean locales", () => {
    // Source of truth: src/components/TestProductMeetingPanel.tsx INPUT_LANGUAGES option
    // labels. These strings are rendered verbatim as <option> text on /live?tool=translator
    // and localized in place by the runtime DOM translator (AppPreferences → translateUi).
    // A missing catalog entry leaves the Korean label on screen in en/ja/zh, which the
    // theme-i18n synthetic-browser regression rejects. Guard the exact translations here.
    const inputLanguageLabels = ["자동 감지 (모든 언어)", "한국어", "영어", "중국어", "일본어"];
    for (const label of inputLanguageLabels) {
      for (const locale of ["en", "zh", "ja"] as const) {
        expect(translateUi(locale, label), `${locale}: ${label}`).not.toMatch(/[가-힣]/);
      }
    }
    expect(translateUi("en", "자동 감지 (모든 언어)")).toBe("Auto-detect (all languages)");
    expect(translateUi("ja", "자동 감지 (모든 언어)")).toBe("自動検出（すべての言語）");
    expect(translateUi("zh", "자동 감지 (모든 언어)")).toBe("自动检测（所有语言）");
    // Korean itself is unchanged (the source label is already Korean copy).
    expect(translateUi("ko", "자동 감지 (모든 언어)")).toBe("자동 감지 (모든 언어)");
  });

  it("keeps transcription and Korean counter fragments semantically correct", () => {
    expect(translateUi("zh", "개")).toBe("项");
    expect(translateUi("zh", "상위")).toBe("上级");
    expect(translateUi("ja", "전사 요청을 보내지 못했습니다")).toBe("文字起こしリクエストを送信できませんでした");
    expect(translateUi("ja", "{\" — \"}로컬 전사를 완료하지 못했습니다. 녹음 원본은 보존되어 있습니다.")).toContain("ローカル文字起こし");
    expect(Object.values(UI_CATALOGS.zh).join("\n")).not.toMatch(/狗|受影响的部署/);
    expect(Object.values(UI_CATALOGS.ja).join("\n")).not.toContain("戦士");
  });

  it("localizes every global-meeting dynamic control and discard string in non-Korean locales", () => {
    const dynamicSources = [
      "내 언어",
      "입력",
      "번역",
      "대화 기록",
      "참석자 등록 없이 세션 화자를 자동 구분하고, 발화 언어를 발화마다 자동으로 인식해 선택한 상대방 언어로 계속 실시간 양방향 번역합니다.",
      "‘내 언어’는 대화록에서 내 쪽으로 표시하고 번역할 선호 언어입니다. 실제 말하는 언어는 발화마다 자동으로 인식되어 한 회의에서 언어를 섞어 말해도 그대로 처리됩니다.",
      "최신 내용 보기",
      "회의록 저장",
      "폐기하기",
      "이 회의를 폐기할까요?",
      "폐기하면 지금까지의 대화가 사라지며 되돌릴 수 없습니다. 이 작업은 저장하지 않으며, 저장된 다른 회의록에는 영향을 주지 않습니다.",
      "돌아가기",
      "폐기 확정",
    ];
    for (const source of dynamicSources) {
      for (const locale of ["en", "zh", "ja"] as const) {
        expect(translateUi(locale, source), `${locale}: ${source}`).not.toMatch(/[가-힣]/);
      }
    }
  });

  it("does not contain duplicate raw JSON keys that JSON.parse would silently overwrite", () => {
    for (const locale of ["en", "zh", "ja"] as const) {
      const raw = readFileSync(join(process.cwd(), "src", "lib", "i18n", "catalogs", `${locale}.json`), "utf8");
      const keys = [...raw.matchAll(/^\s{2}"((?:\\.|[^"])*)":/gm)].map((match) => (
        JSON.parse(`"${match[1]}"`) as string
      ));
      const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
      expect(duplicates, `${locale} duplicate keys`).toEqual([]);
    }
  });

  it("keeps complete locale catalogs aligned and brand-safe", () => {
    const catalogs = Object.entries(UI_CATALOGS);
    const expectedKeys = Object.keys(UI_CATALOGS.en).sort();
    expect(expectedKeys.length).toBeGreaterThanOrEqual(700);

    for (const [locale, catalog] of catalogs) {
      expect(Object.keys(catalog).sort(), `${locale} key coverage`).toEqual(expectedKeys);
      for (const [source, translated] of Object.entries(catalog)) {
        expect(new Set(translated.match(/\{[^}]+\}/g) ?? []), `${locale}: ${source}`).toEqual(
          new Set(source.match(/\{[^}]+\}/g) ?? []),
        );
        expect(translated, `${locale}: ${source}`).not.toContain("헤이홈");
        expect(translated, `${locale}: ${source}`).not.toMatch(/Hey\s*Home|Heyhome|HEJHOME/);
        if (source.includes("헤이홈")) {
          expect(translated).toContain(locale === "en" ? "Soniox" : "Hejhome");
        }
      }
    }
  });
});
