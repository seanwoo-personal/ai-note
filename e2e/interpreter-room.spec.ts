import { expect, test } from "./support/synthetic-test";

// Shared interpreter room (ADR 0028): the host creates a room, a guest joins in
// a separate browser context with the link + password, both see the same
// utterance from their own perspective, and the guest keeps download access
// after the host ends the meeting. Microphone capture is not exercised here;
// the utterance is submitted through the same API the capture hook calls.

test.describe("통역 회의실", () => {
  test("호스트가 방을 만들고 게스트가 링크·비밀번호로 입장해 같은 대화를 본다", async ({ page, browser }) => {
    await page.addInitScript(() => localStorage.setItem("ai-note-locale", "ko"));
    await page.goto("/rooms");
    await expect(page.getByRole("heading", { name: "통역 회의실 만들기" })).toBeVisible();
    await page.getByLabel("회의 제목 (선택)").fill("Vision 정기 미팅");
    await page.getByRole("button", { name: "만들기" }).click();

    await expect(page).toHaveURL(/\/rooms\/[^/]+$/u);
    const roomId = page.url().split("/rooms/")[1];
    await expect(page.getByRole("heading", { name: "Vision 정기 미팅" })).toBeVisible();
    await expect(page.getByText("상대가 아직 입장하지 않았습니다.")).toBeVisible();

    // The invite dialog opens by itself right after creation.
    const inviteDialog = page.getByRole("dialog", { name: "상대를 초대하기" });
    await expect(inviteDialog).toBeVisible();
    await expect(inviteDialog.getByRole("button", { name: "복사하기" })).toBeFocused();
    const inviteUrl = (await inviteDialog.locator("dd").nth(0).innerText()).trim();
    const password = (await inviteDialog.locator("dd").nth(1).innerText()).trim();
    expect(inviteUrl).toContain("/join/");
    expect(password).toMatch(/^[A-Za-z2-9]{8}$/u);
    await inviteDialog.getByRole("button", { name: "닫기" }).click();
    await expect(inviteDialog).toBeHidden();
    await page.getByRole("button", { name: "초대하기" }).click();
    await expect(page.getByRole("dialog", { name: "상대를 초대하기" })).toBeVisible();
    await page.getByRole("dialog", { name: "상대를 초대하기" }).getByRole("button", { name: "닫기" }).click();

    const guestContext = await browser.newContext({ storageState: undefined, baseURL: new URL(page.url()).origin });
    const guest = await guestContext.newPage();
    await guest.addInitScript(() => localStorage.setItem("ai-note-locale", "ko"));
    // A mistyped link is a dead end, never a form.
    await guest.goto(`${new URL(inviteUrl).pathname.slice(0, -2)}xx`);
    await expect(guest.getByRole("heading", { name: "잘못된 접근입니다" })).toBeVisible();
    await expect(guest.getByLabel("이름")).toHaveCount(0);
    await guest.goto(new URL(inviteUrl).pathname);
    await expect(guest.getByRole("heading", { name: "회의실에 입장하기" })).toBeVisible();
    await expect(guest.getByRole("group", { name: "화면 언어" })).toBeVisible();
    await guest.getByLabel("이름").fill("Alex");
    await guest.getByLabel("비밀번호").fill("wrong-password");
    await guest.getByRole("button", { name: "입장" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "링크 또는 비밀번호" })).toHaveText("링크 또는 비밀번호가 올바르지 않거나 만료되었습니다.");
    await guest.getByLabel("비밀번호").fill(password);
    await guest.getByLabel("내 언어").selectOption("en");
    await guest.getByRole("button", { name: "입장" }).click();

    await expect(guest.getByRole("heading", { name: "Vision 정기 미팅" })).toBeVisible();
    await expect(guest.getByRole("list", { name: "참가자" })).toContainText("Alex");
    await expect(page.getByRole("list", { name: "참가자" })).toContainText("Alex", { timeout: 15_000 });

    // Submit through the page so the request carries the same Origin/Fetch
    // Metadata the capture hook's fetch would send.
    const saidStatus = await page.evaluate(async (id) => {
      const response = await fetch(`/api/rooms/${id}/utterances`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utteranceId: "e2e-u1", original: "다음 주 일정 확인 부탁드립니다.", sourceLanguage: "ko" }),
      });
      return response.status;
    }, roomId);
    expect(saidStatus).toBe(200);
    await expect(page.getByRole("region", { name: "대화" }).getByText("다음 주 일정 확인 부탁드립니다.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("상대에게 이렇게 전달됨")).toBeVisible();
    await expect(guest.getByRole("region", { name: "대화" }).getByText("다음 주 일정 확인 부탁드립니다.")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "회의 종료" }).click();
    const dialog = page.getByRole("dialog", { name: "회의를 종료할까요?" });
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await dialog.getByRole("button", { name: "회의 종료" }).click();
    await expect(page.getByText("회의가 끝났습니다. 24시간 안에 기록을 내려받을 수 있습니다.")).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByText("회의가 끝났습니다. 24시간 안에 기록을 내려받을 수 있습니다.")).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByRole("link", { name: "대화록 내려받기" })).toHaveAttribute("href", `/api/rooms/${roomId}/export?kind=transcript&language=en&format=docx`);
    await guest.getByLabel("파일 형식").selectOption("md");
    await expect(guest.getByRole("link", { name: "회의록 내려받기" })).toHaveAttribute("href", `/api/rooms/${roomId}/export?kind=minutes&language=en&format=md`);
    await guest.getByRole("button", { name: "대화록 미리보기" }).click();
    const previewDialog = guest.getByRole("dialog", { name: "대화록 미리보기" });
    await expect(previewDialog).toContainText("다음 주 일정 확인 부탁드립니다.");
    await previewDialog.getByRole("button", { name: "닫기" }).click();

    const transcript = await guest.evaluate(async (id) => {
      const response = await fetch(`/api/rooms/${id}/export?kind=transcript&language=en`);
      return { status: response.status, text: await response.text() };
    }, roomId);
    expect(transcript.status).toBe(200);
    expect(transcript.text).toContain("다음 주 일정 확인 부탁드립니다.");

    const bodyOverflow = await Promise.all([page, guest].map((target) => target.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)));
    expect(bodyOverflow).toEqual([true, true]);
    await guestContext.close();

    // The ended room is now an ordinary meeting of the synthetic host. Remove it
    // so later specs sharing this snapshot keep their fixed library counts.
    // The publisher's post-publish index refresh may still hold the artifact
    // lease for a moment, so retry a brief 409 instead of failing the run.
    const origin = new URL(page.url()).origin;
    let deleted = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await page.request.delete(`/api/meetings/${roomId}`, {
        headers: { origin, "sec-fetch-site": "same-origin" },
      });
      deleted = response.status();
      if (deleted !== 409) break;
      await page.waitForTimeout(250);
    }
    expect([200, 202]).toContain(deleted);
  });
});
