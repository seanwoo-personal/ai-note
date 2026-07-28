import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  brandNameForLocale,
  APP_PREFERENCES_BOOTSTRAP_SCRIPT,
  parseLocale,
  parseTheme,
  resolveTheme,
} from "@/lib/appPreferences";

describe("app preferences", () => {
  it("accepts the four supported locales and falls back safely", () => {
    expect(["ko", "en", "zh", "ja"].map(parseLocale)).toEqual(["ko", "en", "zh", "ja"]);
    expect(parseLocale("fr")).toBe("ko");
    expect(parseLocale(null)).toBe("ko");
  });

  it("accepts light, dark, and system themes and resolves system preference", () => {
    expect(["light", "dark", "system"].map(parseTheme)).toEqual(["light", "dark", "system"]);
    expect(parseTheme("contrast")).toBe("system");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("uses the exact localized Hejhome brand spelling", () => {
    expect(brandNameForLocale("ko")).toBe("헤이홈");
    expect(brandNameForLocale("en")).toBe("Hejhome");
    expect(brandNameForLocale("zh")).toBe("Hejhome");
    expect(brandNameForLocale("ja")).toBe("Hejhome");
  });

  it("applies browser fallbacks before hydration when localStorage is denied", () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      style: {} as Record<string, string>,
      lang: "ko",
    };
    runInNewContext(APP_PREFERENCES_BOOTSTRAP_SCRIPT, {
      document: { documentElement: root },
      localStorage: { getItem: () => { throw new Error("denied"); } },
      matchMedia: () => ({ matches: true }),
      navigator: { language: "en-US" },
    });
    expect(attributes.get("data-theme")).toBe("dark");
    expect(attributes.get("data-theme-preference")).toBe("system");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.lang).toBe("ko");
  });
});
