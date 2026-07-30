import { expect, test } from "./support/synthetic-test";

test("v1.16.0 release, independent scrolling, and meeting products are visible", async ({ page }) => {
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

  await expect(navigation.getByText("제품 버전 1.16.0")).toBeVisible();
  await navigation.getByRole("link", { name: "릴리즈 노트" }).click();
  await expect(page).toHaveURL(/\/settings\/releases$/);
  await expect(page.getByRole("heading", { name: "릴리즈 노트" })).toBeVisible();
  await expect(page.getByText("v1.16.0", { exact: true })).toBeVisible();
  await expect(page.getByText("기준판 이후 22회 업데이트", { exact: true })).toBeVisible();
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

  await page.goto("/soniox?tool=translator");
  await expect(page).toHaveURL(/tool=test-product/);
  await expect(page.getByLabel("회의 참석자 수")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "트랜슬레이터" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "자유 참여 글로벌 미팅" })).toBeVisible();
  await expect(page.getByLabel("회의 참석자 수")).toHaveCount(0);
  await expect(page.getByText(/그룹 A|그룹 B/)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "입력 언어" })).toHaveValue("ko");
  await expect(page.getByRole("combobox", { name: "번역할 언어" })).toHaveValue("en");
  await expect(page.getByRole("combobox", { name: "번역 음성" })).toHaveValue("Maya");
  await expect(page.getByRole("combobox", { name: "음성 속도" })).toHaveValue("1");
  await expect(page.getByRole("table", { name: "트랜슬레이터 대화록" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Push-to-Talk 상태" })).toContainText("마이크와 실시간 번역");
});
