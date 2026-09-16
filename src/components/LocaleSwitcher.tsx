"use client";

import { useOptionalAppPreferences } from "@/components/AppPreferences";
import type { AppLocale } from "@/lib/appPreferences";

// Display-language switcher for surfaces outside the product shell (login,
// guest room). Order is the product rule: Japanese → English → Korean. Labels
// are locale-invariant and excluded from the i18n observer.

export const DISPLAY_LANGUAGE_OPTIONS = [
  { locale: "ja", label: "日本語" },
  { locale: "en", label: "English" },
  { locale: "ko", label: "한국어" },
] as const satisfies ReadonlyArray<{ locale: AppLocale; label: string }>;

export type DisplayLocale = (typeof DISPLAY_LANGUAGE_OPTIONS)[number]["locale"];

export function currentDisplayLocale(locale: AppLocale | undefined): DisplayLocale {
  return locale === "en" || locale === "ko" ? locale : "ja";
}

export function LocaleSwitcher({
  groupLabel,
  className = "mb-6 flex justify-end",
}: {
  groupLabel: Record<DisplayLocale, string>;
  className?: string;
}) {
  const preferences = useOptionalAppPreferences();
  const locale = currentDisplayLocale(preferences?.locale);
  return (
    <div className={className}>
      <div
        role="group"
        aria-label={groupLabel[locale]}
        data-i18n-user-attributes
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-bg p-1"
      >
        {DISPLAY_LANGUAGE_OPTIONS.map((language) => {
          const selected = locale === language.locale;
          return (
            <button
              key={language.locale}
              type="button"
              aria-pressed={selected}
              onClick={() => preferences?.setLocale(language.locale)}
              className={`min-h-9 rounded-md px-3 text-[12px] font-semibold transition-colors ${selected ? "bg-panel text-accent shadow-sm" : "text-inkSoft hover:text-ink"}`}
            >
              <span data-i18n-user-content>{language.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const ROOM_LANGUAGE_GROUP_LABEL: Record<DisplayLocale, string> = {
  ko: "화면 언어",
  en: "Screen language",
  ja: "画面の言語",
};
