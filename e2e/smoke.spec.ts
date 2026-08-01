import { expect, test } from "./support/synthetic-test";

test("synthetic library shell is usable without external traffic", async ({ page }) => {
  const libraryResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/library"
  ));
  const whisperResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/whisper/health"
  ));
  const llmResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/settings/llm/health"
  ));
  await page.goto("/");
  const libraryResponse = await libraryResponsePromise;
  const whisperResponse = await whisperResponsePromise;
  const llmResponse = await llmResponsePromise;

  expect(
    libraryResponse.ok(),
    `synthetic library response status: ${libraryResponse.status()}`,
  ).toBe(true);
  expect(await libraryResponse.json(), "synthetic library state").toMatchObject({
    mode: "ready",
    library: { counts: { visibleMeetingCount: 8 } },
  });
  expect(await whisperResponse.json(), "synthetic Whisper state").toMatchObject({ connected: false });
  expect(await llmResponse.json(), "synthetic LLM state").toEqual({ configured: false });
  await expect(page).toHaveTitle("헤이홈 AI 기록도구");
  await expect(page.locator("main#main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "최근 작업한 문서" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "바로 시작" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Whisper 전사용 녹음 시작" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "최근 작업한 문서 목록" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "아직 회의록이 없습니다" })).toHaveCount(0);
});
