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

type Locale = "en" | "zh" | "ja";

// The product name is the locale-invariant Vision customer brand.
const titles: Record<Locale, string> = {
  en: "Vision AI 미팅 에이전트",
  zh: "Vision AI 미팅 에이전트",
  ja: "Vision AI 미팅 에이전트",
};

async function expectLocalizedSurface(page: Page) {
  await expect.poll(async () => page.evaluate(() => document.documentElement.lang)).not.toBe("ko");
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

test("all non-Korean locales translate Home and Translator without overflow or translating records", async ({ page }, testInfo) => {
  const { manualEditingMeetingForProject } = await fixtureModule;
  const userMeetingTitle = manualEditingMeetingForProject(testInfo.project.name).title;
  await page.goto("/");

  for (const locale of ["en", "zh", "ja"] as const) {
    await page.evaluate((value) => localStorage.setItem("ai-note-locale", value), locale);
    await page.goto("/");
    await expect(page).toHaveTitle(titles[locale]);
    await expect(page.getByText(userMeetingTitle, {
      exact: false,
    }).first()).toBeVisible();
    await expectLocalizedSurface(page);

    await page.goto("/live?tool=translator");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main select")).toHaveCount(4);
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
