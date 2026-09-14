import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "./support/synthetic-test";

type FirstRunFixtureModule = typeof import("../scripts/e2e-first-run-fixture.mjs");
type ManualEditingFixtureModule = typeof import("../scripts/e2e-manual-editing-fixture.mjs");
const importRuntimeModule = new Function(
  "specifier",
  "return import(specifier)",
) as <Module>(specifier: string) => Promise<Module>;
const firstRunFixtureModule = importRuntimeModule<FirstRunFixtureModule>(pathToFileURL(join(
  __dirname,
  "../scripts/e2e-first-run-fixture.mjs",
)).href);
const manualFixtureModule = importRuntimeModule<ManualEditingFixtureModule>(pathToFileURL(join(
  __dirname,
  "../scripts/e2e-manual-editing-fixture.mjs",
)).href);

async function attachMilestone(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`browser-screenshot:${name}`, {
    body: await page.screenshot({ fullPage: true, caret: "initial" }),
    contentType: "image/png",
  });
}

async function expectMinimumTarget(locator: Locator) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

async function fulfillJson(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

test("customer-safe first run, system-audio choice, and transcription recovery stay synthetic", {
  annotation: [
    { type: "requirement", description: "R2" },
    { type: "requirement", description: "R3" },
    { type: "requirement", description: "R4" },
    { type: "requirement", description: "R5" },
    { type: "requirement", description: "R6" },
    { type: "requirement", description: "R7" },
  ],
}, async ({ page }, testInfo) => {
  const { firstRunMeetingForProject } = await firstRunFixtureModule;
  const { manualEditingMeetingForProject } = await manualFixtureModule;
  const failureMeeting = firstRunMeetingForProject(testInfo.project.name);
  const completedMeeting = manualEditingMeetingForProject(testInfo.project.name);

  const transcribePayloads: Array<Record<string, unknown>> = [];
  let releaseTranscribe: (() => void) | null = null;
  const releasePendingTranscribe = () => releaseTranscribe?.();
  let activeMeetingPolls = 0;
  let maximumMeetingPolls = 0;

  await page.route("**/api/settings/llm/health", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // Keep the mocked client fetch behind the initial server render so the
    // persistent layout hydrates from the same loading state on every document.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return fulfillJson(route, { configured: false });
  });
  await page.route("**/api/realtime/temporary-key", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return fulfillJson(route, { configured: false });
  });
  await page.route("**/api/settings/profile", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return fulfillJson(route, {
      configured: false,
      defaults: { timezone: "Asia/Seoul", weekStartsOn: "monday" },
    });
  });
  await page.route("**/api/transcribe", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    transcribePayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await new Promise<void>((resolve) => {
      releaseTranscribe = resolve;
    });
    return fulfillJson(route, {
      id: failureMeeting.meetingId,
      status: "transcribing",
      durability: "durable",
    });
  });
  await page.route(`**/api/meetings/${failureMeeting.meetingId}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    activeMeetingPolls += 1;
    maximumMeetingPolls = Math.max(maximumMeetingPolls, activeMeetingPolls);
    await fulfillJson(route, {
      id: failureMeeting.meetingId,
      status: "recorded",
      error: { action: "retry_transcription", message: "합성 전사 실패" },
    });
    activeMeetingPolls -= 1;
  });

  await page.goto("/");
  const readinessCard = page.getByRole("heading", { name: "AI 회의록을 준비하고 있습니다" })
    .locator("..");
  await expect(readinessCard).toContainText(
    "AI 회의록 기능을 준비하고 있습니다.",
  );
  await expect(readinessCard).toContainText(
    "회의 녹음과 실시간 자막·번역을 사용할 수 있습니다.",
  );
  const continueRecording = readinessCard.getByRole("button", { name: "회의 녹음 계속" });
  const recorderStart = page.getByRole("button", { name: "회의 녹음 시작" });
  await expect(continueRecording).toBeVisible();
  await expect(recorderStart).toBeEnabled();
  await expect(page.getByRole("radio", { name: /마이크와 회의 소리/u })).toBeVisible();
  await expectMinimumTarget(readinessCard.locator("button"));
  await expectMinimumTarget(recorderStart);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  expect(await readinessCard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await attachMilestone(page, testInfo, `${testInfo.project.name}-home-first-run`);

  await continueRecording.click();
  await expect(recorderStart).toBeFocused();
  expect(await recorderStart.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  })).toBe(true);

  await page.goto("/settings");
  const fontSizeHeading = page.getByRole("heading", { level: 2, name: "글자 크기" });
  const profileHeading = page.getByRole("heading", { level: 2, name: "내 정보" });
  await expect(fontSizeHeading).toBeVisible();
  await expect(profileHeading).toBeVisible();
  expect(await fontSizeHeading.evaluate((fontSize) => {
    const profile = document.getElementById("user-profile-heading");
    return Boolean(
      profile
      && (fontSize.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
  })).toBe(true);
  await expect(page.getByText(
    "내 정보가 없어도 녹음·전사·일반 검색을 사용할 수 있습니다.",
  )).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(
    /OpenRouter|Soniox|Ollama|API 키|요약 모델|모델 백엔드|Base URL/iu,
  );
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await attachMilestone(page, testInfo, `${testInfo.project.name}-customer-settings`);

  await page.goto(`/meetings/${completedMeeting.meetingId}`);
  await expect(page.getByRole("tab", { name: "회의록 요약", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText(
    "합성 회의에서 수동 편집과 안전한 이탈 보호를 검증한다.",
    { exact: true },
  )).toBeVisible();
  await page.goto(`/meetings/${completedMeeting.meetingId}?contentTab=script`);
  await expect(page.getByRole("tab", { name: "전체 스크립트", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.goto("/");
  const failureRow = page.getByRole("link").filter({ hasText: failureMeeting.title });
  const failureDetailPath = `/meetings/${failureMeeting.meetingId}`;
  if (await failureRow.count() > 0) {
    await expect(failureRow).toContainText("전사 실패");
    await expect(failureRow).toHaveAttribute("href", failureDetailPath);
  }
  const meetingIndex = await page.request.get("/api/meetings?view=global&sort=updated&limit=100");
  expect(meetingIndex.ok()).toBe(true);
  expect(JSON.stringify(await meetingIndex.json())).toContain(failureMeeting.meetingId);
  await page.goto(failureDetailPath);
  await expect(page.getByRole("heading", { name: failureMeeting.title })).toBeVisible();
  await expect(page.getByText("전사 실패", { exact: true }).first()).toBeVisible();
  const retry = page.getByRole("button", { name: /^전사 (?:다시 시도|요청 중…)$/u });
  await expect(retry).toBeVisible();
  await expectMinimumTarget(retry);
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText("전사 요청 중…");
  expect(transcribePayloads).toEqual([{ id: failureMeeting.meetingId }]);
  releasePendingTranscribe();
  await expect(page.getByRole("status", { name: "전사 다시 시도 상태" })).toContainText(
    "전사 요청을 접수했습니다.",
  );
  await expect(retry).toBeFocused();
  await expect.poll(() => maximumMeetingPolls).toBe(1);
  expect(maximumMeetingPolls).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await attachMilestone(page, testInfo, `${testInfo.project.name}-transcription-retry`);
});
