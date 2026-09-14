// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANDROID_APP_BOOTSTRAP_SCRIPT } from "@/lib/androidAppBootstrap";

describe("ANDROID_APP_BOOTSTRAP_SCRIPT", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-ai-note-android-app");
    vi.unstubAllGlobals();
  });

  it("marks only the dedicated Android WebView user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 hejhome-ai-note-android/1.3",
    });

    Function(ANDROID_APP_BOOTSTRAP_SCRIPT)();

    expect(document.documentElement.getAttribute("data-ai-note-android-app")).toBe("true");
  });

  it("leaves ordinary browsers unchanged", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/140" });

    Function(ANDROID_APP_BOOTSTRAP_SCRIPT)();

    expect(document.documentElement.hasAttribute("data-ai-note-android-app")).toBe(false);
  });
});
