import { expect, test as base } from "@playwright/test";

type SyntheticFixtures = {
  syntheticBrowserEvidence: void;
};

export const test = base.extend<SyntheticFixtures>({
  syntheticBrowserEvidence: [async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const expectedNetworkConsoleErrors: string[] = [];
    const externalRequests: string[] = [];

    await page.addInitScript(() => {
      if (!localStorage.getItem("ai-note-locale")) {
        localStorage.setItem("ai-note-locale", "ko");
      }
    });

    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      const permitsSynthetic503 = testInfo.annotations.some((annotation) =>
        annotation.type === "expected-network-failure-console"
        && annotation.description === "temporary-key-http-503"
      );
      if (
        permitsSynthetic503
        && text === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      ) {
        expectedNetworkConsoleErrors.push(text);
        return;
      }
      consoleErrors.push(text);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
        && url.hostname !== "127.0.0.1"
        && url.hostname !== "localhost"
      ) {
        externalRequests.push(request.url());
      }
    });

    await use();

    if (page.isClosed()) throw new Error("synthetic browser page closed before evidence capture");
    await testInfo.attach("browser-screenshot", {
      body: await page.screenshot({ fullPage: true, caret: "initial" }),
      contentType: "image/png",
    });
    await testInfo.attach("browser-console", {
      body: Buffer.from(JSON.stringify({
        uncaughtOrUnexpectedErrors: consoleErrors,
        expectedNetworkFailureErrors: expectedNetworkConsoleErrors,
      }, null, 2)),
      contentType: "application/json",
    });
    await testInfo.attach("browser-network", {
      body: Buffer.from(JSON.stringify({ externalRequests }, null, 2)),
      contentType: "application/json",
    });

    if (consoleErrors.length > 0) {
      throw new Error(`browser console errors: ${consoleErrors.join(" | ")}`);
    }
    if (externalRequests.length > 0) {
      throw new Error(`external browser requests: ${externalRequests.join(" | ")}`);
    }
  }, { auto: true }],
});

export { expect };
