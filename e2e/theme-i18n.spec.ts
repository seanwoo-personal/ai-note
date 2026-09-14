import type { Page } from "@playwright/test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "./support/synthetic-test";

type ManualEditingFixtureModule = typeof import("../scripts/e2e-manual-editing-fixture.mjs");
const importRuntimeModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<ManualEditingFixtureModule>;
const fixtureModule = importRuntimeModule(pathToFileURL(join(
  __dirname,
  "../scripts/e2e-manual-editing-fixture.mjs",
)).href);

type Locale = "en" | "ja";

// The product name is the locale-invariant Vision customer brand.
const titles: Record<Locale, string> = {
  en: "Vision AI 미팅 에이전트",
  ja: "Vision AI 미팅 에이전트",
};

async function expectLocalizedSurface(page: Page) {
  await expect.poll(async () => page.evaluate(() => document.documentElement.lang)).not.toBe("ko");
  const wrapping = await page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(document.body);
    return { lang: root.lang, wordBreak: style.wordBreak, lineBreak: style.lineBreak };
  });
  expect(wrapping.wordBreak).toBe("normal");
  if (wrapping.lang === "ja" || wrapping.lang === "zh") expect(wrapping.lineBreak).toBe("strict");
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  expect(overflow).toBe(false);

  const untranslated = await page.evaluate(() => {
    const hangul = /[가-힣]/u;
    const userStrings = [...document.querySelectorAll<HTMLElement>("[data-i18n-user-content]")]
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);
    const includesUserContent = (value: string) => userStrings.some((content) => value.includes(content));
    const values: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? "";
      if (
        text
        && hangul.test(text)
        && parent
        && !parent.closest("[data-i18n-user-content]")
        && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)
      ) values.push(text);
      node = walker.nextNode();
    }
    for (const element of document.querySelectorAll<HTMLElement>("[aria-label], [title], [placeholder]")) {
      if (element.closest("[data-i18n-user-content]")) continue;
      for (const attribute of ["aria-label", "title", "placeholder"] as const) {
        const value = element.getAttribute(attribute);
        if (value && hangul.test(value) && !includesUserContent(value)) values.push(`${attribute}: ${value}`);
      }
    }
    return [...new Set(values)];
  });
  expect(untranslated).toEqual([]);
}

test("first visit opens the login screen in Japanese with Japan-first language order", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("ai-note-locale"));
  await page.goto("/login");

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { name: "AIノートを始めましょう" })).toBeVisible();
  const languageGroup = page.getByRole("group", { name: "ログイン画面の言語" });
  await expect(languageGroup.getByRole("button")).toHaveText(["日本語", "English", "한국어"]);
});

test("Korean UI copy keeps words intact while long token values can still wrap", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => localStorage.setItem("ai-note-locale", "ko"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  const wrapping = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { wordBreak: body.wordBreak, overflowWrap: body.overflowWrap, hyphens: body.hyphens };
  });
  expect(wrapping).toEqual({ wordBreak: "keep-all", overflowWrap: "break-word", hyphens: "none" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("customer login switches directly between Korean, English, and Japanese", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => localStorage.setItem("ai-note-locale", "ko"));
  await page.reload();

  const languageGroup = page.getByRole("group", { name: "로그인 화면 언어" });
  await expect(languageGroup.getByRole("button")).toHaveCount(3);

  await languageGroup.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Start using AI Note" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expectLocalizedSurface(page);

  await page.getByRole("group", { name: "Login screen language" }).getByRole("button", { name: "日本語" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { name: "AIノートを始めましょう" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expectLocalizedSurface(page);
});

test("all non-Korean locales translate Home and Translator without overflow or translating records", async ({ page }, testInfo) => {
  const { manualEditingMeetingForProject } = await fixtureModule;
  const userMeetingTitle = manualEditingMeetingForProject(testInfo.project.name).title;
  await page.goto("/");

  for (const locale of ["en", "ja"] as const) {
    await page.evaluate((value) => localStorage.setItem("ai-note-locale", value), locale);
    await page.goto("/");
    await expect(page).toHaveTitle(titles[locale]);
    await expect(page.getByText(userMeetingTitle, {
      exact: false,
    }).first()).toBeVisible();
    await expectLocalizedSurface(page);

    await page.goto("/live?tool=translator");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main").getByRole("combobox")).toHaveCount(5);
    await expectLocalizedSurface(page);
  }
});

test("light, dark, and system preferences survive reload", async ({ page }) => {
  await page.goto("/");
  for (const theme of ["light", "dark", "system"] as const) {
    await page.evaluate((value) => localStorage.setItem("ai-note-theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/u);
  }
});
