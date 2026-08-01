import { expect, test } from "./support/synthetic-test";

test("v1.17.0 release, independent scrolling, and meeting products are visible", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e-release-initialized") !== "true") {
      localStorage.setItem("ai-note-locale", "ko");
      localStorage.setItem("ai-note-font-size", "default");
      localStorage.setItem("e2e-release-initialized", "true");
    }
  });
  await page.goto("/settings");
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) < 1024) {
    await page.getByRole("button", { name: "라이브러리 메뉴 열기" }).click();
  }
  const navigation = (viewport?.width ?? 0) < 1024
    ? page.getByLabel("라이브러리 메뉴", { exact: true })
    : page.getByRole("navigation", { name: "라이브러리" });

  await expect(navigation.getByText("제품 버전 1.17.0")).toBeVisible();
  await navigation.getByRole("link", { name: "릴리즈 노트" }).click();
  await expect(page).toHaveURL(/\/settings\/releases$/);
  await expect(page.getByRole("heading", { name: "릴리즈 노트" })).toBeVisible();
  await expect(page.getByText("v1.17.0", { exact: true })).toBeVisible();
  await expect(page.getByText("기준판 이후 23회 업데이트", { exact: true })).toBeVisible();
  await expect(page.getByText("v1.0.0 · AI NOTE 오픈소스 기준판", { exact: true })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "글자 크기 한 단계 크게" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSize)).toBe("large");
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSize)).toBe("large");

  const layout = await page.evaluate(() => {
    const navigation = document.querySelector("nav[aria-label]");
    const content = document.querySelector("#app-content");
    return {
      navigationOverflow: navigation ? getComputedStyle(navigation).overflowY : "missing",
      contentOverflow: content ? getComputedStyle(content).overflowY : "missing",
      bodyOverflow: getComputedStyle(document.body).overflowY,
    };
  });
  if ((viewport?.width ?? 0) >= 1024) {
    expect(layout.navigationOverflow).toBe("auto");
    expect(layout.contentOverflow).toBe("auto");
  } else {
    expect(layout.bodyOverflow).not.toBe("hidden");
  }

  await page.goto("/live?tool=translator");
  await expect(page).toHaveURL(/tool=test-product/);
  await expect(page.getByLabel("회의 참석자 수")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "글로벌 미팅 번역" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "자유 참여 글로벌 미팅" })).toBeVisible();
  await expect(page.getByLabel("회의 참석자 수")).toHaveCount(0);
  await expect(page.getByText(/그룹 A|그룹 B/)).toHaveCount(0);

  // AC1/AC2: truthful language labels ("내 언어"/"상대방 언어") replace the old
  // recognition-implying "입력 언어"/"번역할 언어" wording, values stay wired.
  await expect(page.getByRole("combobox", { name: "입력 언어" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "번역할 언어" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "내 언어" })).toHaveValue("ko");
  await expect(page.getByRole("combobox", { name: "상대방 언어" })).toHaveValue("en");
  await expect(page.getByRole("combobox", { name: "번역 음성" })).toHaveValue("Maya");
  await expect(page.getByRole("combobox", { name: "음성 속도" })).toHaveValue("1");
  await expect(page.getByText(/발화마다 자동으로 인식/).first()).toBeVisible();

  const table = page.getByRole("table", { name: "글로벌 미팅 번역 대화록" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["입력", "번역"]);

  const settingsSurface = page.locator("[data-surface='settings']");
  const transcriptSurface = page.getByRole("region", { name: "대화 기록" });
  await expect(settingsSurface).toBeVisible();
  await expect(transcriptSurface).toBeVisible();
  const surfaceBackgrounds = await page.evaluate(() => {
    const settings = document.querySelector("[data-surface='settings']");
    const transcript = document.querySelector("[data-surface='transcript']");
    return {
      settings: settings ? getComputedStyle(settings).backgroundColor : null,
      transcript: transcript ? getComputedStyle(transcript).backgroundColor : null,
    };
  });
  expect(surfaceBackgrounds.settings).not.toBeNull();
  expect(surfaceBackgrounds.transcript).not.toBeNull();
  expect(surfaceBackgrounds.settings).not.toBe(surfaceBackgrounds.transcript);

  await expect(page.getByRole("status", { name: "Push-to-Talk 상태" })).toContainText("마이크와 실시간 번역");
  const horizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(horizontalOverflow).toBe(false);
});
