import { expect, test } from "./support/synthetic-test";

test("release history, font sizing, independent scrolling, and speaker setup are visible", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e-release-initialized") !== "true") {
      localStorage.setItem("ai-note-locale", "ko");
      localStorage.setItem("ai-note-font-size", "default");
      localStorage.setItem("e2e-release-initialized", "true");
    }
  });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "릴리즈 노트" })).toBeVisible();
  await expect(page.getByText("v1.12", { exact: true })).toBeVisible();
  await expect(page.getByText("기준판 이후 12회 업데이트", { exact: true })).toBeVisible();
  await expect(page.getByText("v1.0 · AI NOTE 오픈소스 기준판", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "글자 크기 한 단계 크게" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSize)).toBe("large");
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSize)).toBe("large");

  const viewport = page.viewportSize();
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
  await page.getByRole("button", { name: "화자 구분 통역" }).click();
  await expect(page.getByRole("region", { name: "화자별 실시간 통역" })).toBeVisible();
  await expect(page.getByLabel("우리 팀 인원")).toHaveValue("1");
  await expect(page.getByLabel("상대 팀 인원")).toHaveValue("1");
  await expect(page.getByRole("button", { name: "화자 등록 시작" })).toBeVisible();
  await expect(page.getByText(/영구 음성 생체 등록이 아니라/)).toBeVisible();
});
