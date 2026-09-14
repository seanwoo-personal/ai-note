import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  APP_PREFERENCES_BOOTSTRAP_SCRIPT,
  parseFontSize,
  parseLocale,
  parseTheme,
  resolveTheme,
} from "@/lib/appPreferences";

describe("app preferences", () => {
  it("accepts supported locales and defaults new customers to Japanese", () => {
    expect(["ko", "en", "zh", "ja"].map(parseLocale)).toEqual(["ko", "en", "zh", "ja"]);
    expect(parseLocale("fr")).toBe("ja");
    expect(parseLocale(null)).toBe("ja");
  });

  it("accepts light, dark, and system themes and resolves system preference", () => {
    expect(["light", "dark", "system"].map(parseTheme)).toEqual(["light", "dark", "system"]);
    // Light is the default a first run opens in. "system" stays selectable, but
    // it is no longer what an unset preference falls back to.
    expect(parseTheme("contrast")).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("accepts supported font-size steps and falls back to the default step", () => {
    expect(["small", "default", "large", "extra-large"].map(parseFontSize)).toEqual([
      "small", "default", "large", "extra-large",
    ]);
    expect(parseFontSize("huge")).toBe("default");
    expect(parseFontSize(null)).toBe("default");
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
    // matchMedia reports the OS preferring dark, but light is the default, so a
    // first run opens light — the OS preference only applies once the user picks
    // "system" themselves.
    expect(attributes.get("data-theme")).toBe("light");
    expect(attributes.get("data-theme-preference")).toBe("light");
    expect(attributes.get("data-font-size")).toBe("default");
    expect(root.style.colorScheme).toBe("light");
    expect(root.lang).toBe("ja");
  });
});
