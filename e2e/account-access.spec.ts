import { expect, test } from "./support/synthetic-test";

test("고객 로그인 후 기존 AI 노트 홈을 연다", async ({ page }) => {
  await page.context().clearCookies();
  await page.addInitScript(() => localStorage.setItem("ai-note-locale", "ko"));
  await page.goto("/");

  await expect(page).toHaveURL(/\/login\?next=/u);
  await expect(page.getByRole("heading", { name: "AI 노트를 시작하세요" })).toBeVisible();
  await expect(page.getByRole("link", { name: "비밀번호를 잊으셨나요?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "운영자 화면으로 이동" })).toBeVisible();

  await page.getByLabel("이메일").fill("customer@example.jp");
  await page.getByLabel("비밀번호").fill("CustomerPass!2026");
  await page.getByRole("button", { name: "AI 노트로 들어가기" }).click();

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { level: 1, name: "최근 작업한 문서" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "바로 시작" })).toBeVisible();
  const libraryMenu = page.getByRole("button", { name: "라이브러리 메뉴 열기" });
  if (await libraryMenu.isVisible()) {
    await libraryMenu.click();
    await expect(page.getByLabel("라이브러리 메뉴", { exact: true }).getByText("비전 합성 고객사")).toBeVisible();
  } else {
    await expect(page.getByText("비전 합성 고객사")).toBeVisible();
  }
});

test("가입 이메일로 임시 비밀번호 발송을 요청한다", async ({ page }, testInfo) => {
  await page.context().clearCookies();
  await page.addInitScript(() => localStorage.setItem("ai-note-locale", "ko"));
  await page.goto("/login");
  await page.getByRole("link", { name: "비밀번호를 잊으셨나요?" }).click();

  await expect(page).toHaveURL(/\/forgot-password$/u);
  await expect(page.getByRole("heading", { name: "임시 비밀번호를 받아보세요" })).toBeVisible();
  await page.getByLabel("가입 이메일").fill(`unknown-${testInfo.project.name}@example.jp`);
  await page.getByRole("button", { name: "임시 비밀번호 받기" }).click();
  await expect(page.getByRole("status")).toHaveText("가입된 이메일이라면 임시 비밀번호를 발송했습니다.");
});
