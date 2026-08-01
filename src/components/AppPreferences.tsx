"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AppLocale,
  brandNameForLocale,
  type FontSizePreference,
  parseFontSize,
  parseLocale,
  parseTheme,
  type ResolvedTheme,
  resolveTheme,
  SUPPORTED_FONT_SIZES,
  SUPPORTED_LOCALES,
  type ThemePreference,
} from "@/lib/appPreferences";
import { translateUi, type UiValues } from "@/lib/i18n";

const LOCALE_STORAGE_KEY = "ai-note-locale";
const THEME_STORAGE_KEY = "ai-note-theme";
const FONT_SIZE_STORAGE_KEY = "ai-note-font-size";
const DARK_QUERY = "(prefers-color-scheme: dark)";

type AppPreferencesValue = {
  locale: AppLocale;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  fontSize: FontSizePreference;
  brandName: "Vision";
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: ThemePreference) => void;
  setFontSize: (fontSize: FontSizePreference) => void;
  t: (source: string, values?: UiValues) => string;
};

const AppPreferencesContext = createContext<AppPreferencesValue | null>(null);

function preferredBrowserLocale(): AppLocale {
  if (typeof navigator === "undefined") return "ko";
  for (const language of navigator.languages ?? [navigator.language]) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "ko" || base === "en" || base === "zh" || base === "ja") return base;
  }
  return "ko";
}

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the selected preference in memory when browser storage is unavailable.
  }
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("ko");
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [fontSize, setFontSizeState] = useState<FontSizePreference>("default");
  const [fontSizeLoaded, setFontSizeLoaded] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  const textSources = useRef(new WeakMap<Text, { source: string; rendered: string }>());
  const attributeSources = useRef(new WeakMap<Element, Map<string, { source: string; rendered: string }>>());

  useEffect(() => {
    const storedLocale = readStoredPreference(LOCALE_STORAGE_KEY);
    setLocaleState(storedLocale && SUPPORTED_LOCALES.includes(storedLocale as AppLocale)
      ? parseLocale(storedLocale)
      : preferredBrowserLocale());
    setThemeState(parseTheme(readStoredPreference(THEME_STORAGE_KEY)));
    setFontSizeState(parseFontSize(readStoredPreference(FONT_SIZE_STORAGE_KEY)));
    setFontSizeLoaded(true);
    let media: MediaQueryList | null = null;
    try {
      media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
      setSystemDark(media?.matches ?? false);
    } catch {
      setSystemDark(false);
    }
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media?.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media?.removeListener(onChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = theme;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, theme]);

  useEffect(() => {
    if (!fontSizeLoaded) return;
    document.documentElement.dataset.fontSize = fontSize;
  }, [fontSize, fontSizeLoaded]);

  useEffect(() => {
    // Product name is a locale-invariant Vision brand string.
    const title = "Vision AI 미팅 에이전트";
    const description = translateUi(locale, "회의 녹음, 실시간 전사·번역, 회의록 요약");
    const maintainLocalizedMetadata = () => {
      if (document.title !== title) document.title = title;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (meta && meta.content !== description) meta.content = description;
    };
    maintainLocalizedMetadata();
    const observer = new MutationObserver(maintainLocalizedMetadata);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["content"] });
    return () => observer.disconnect();
  }, [locale]);

  useEffect(() => {
    const excludedText = (element: Element | null) => Boolean(element?.closest(
      "[data-i18n-user-content], textarea, [contenteditable='true'], script, style",
    ));
    const excludedAttribute = (element: Element | null) => Boolean(element?.closest(
      "[data-i18n-user-content], [data-i18n-user-attributes], textarea, [contenteditable='true'], script, style",
    ));
    const localizeText = (node: Text) => {
      if (excludedText(node.parentElement)) return;
      const current = node.data;
      const previous = textSources.current.get(node);
      const source = previous && current === previous.rendered ? previous.source : current;
      const match = source.match(/^(\s*)(.*?)(\s*)$/s);
      if (!match || !match[2]) return;
      const rendered = `${match[1]}${translateUi(locale, match[2])}${match[3]}`;
      textSources.current.set(node, { source, rendered });
      if (rendered !== current) node.data = rendered;
    };
    const localizeAttribute = (element: Element, name: string) => {
      if (excludedAttribute(element)) return;
      const current = element.getAttribute(name);
      if (current === null) return;
      let records = attributeSources.current.get(element);
      if (!records) {
        records = new Map();
        attributeSources.current.set(element, records);
      }
      const previous = records.get(name);
      const source = previous && current === previous.rendered ? previous.source : current;
      const rendered = translateUi(locale, source);
      records.set(name, { source, rendered });
      if (rendered !== current) element.setAttribute(name, rendered);
    };
    const localizeTree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        localizeText(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current: Node | null = root;
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) localizeText(current as Text);
        else if (current.nodeType === Node.ELEMENT_NODE) {
          for (const name of ["aria-label", "title", "placeholder", "alt"]) {
            localizeAttribute(current as Element, name);
          }
        }
        current = walker.nextNode();
      }
    };

    localizeTree(document.body);
    document.documentElement.lang = locale;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeText(mutation.target as Text);
        else if (mutation.type === "attributes") localizeAttribute(
          mutation.target as Element,
          mutation.attributeName ?? "",
        );
        else for (const node of mutation.addedNodes) localizeTree(node);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder", "alt"],
    });
    return () => observer.disconnect();
  }, [locale]);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    persistPreference(LOCALE_STORAGE_KEY, next);
  }, []);
  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    persistPreference(THEME_STORAGE_KEY, next);
  }, []);
  const setFontSize = useCallback((next: FontSizePreference) => {
    setFontSizeState(next);
    persistPreference(FONT_SIZE_STORAGE_KEY, next);
  }, []);

  const value = useMemo<AppPreferencesValue>(() => ({
    locale,
    theme,
    resolvedTheme,
    fontSize,
    brandName: brandNameForLocale(locale),
    setLocale,
    setTheme,
    setFontSize,
    t: (source, values) => translateUi(locale, source, values),
  }), [fontSize, locale, resolvedTheme, setFontSize, setLocale, setTheme, theme]);

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences(): AppPreferencesValue {
  const value = useOptionalAppPreferences();
  if (!value) throw new Error("AppPreferencesProvider is required");
  return value;
}

export function useOptionalAppPreferences(): AppPreferencesValue | null {
  return useContext(AppPreferencesContext);
}

export function LocalizedText({ source, values }: { source: string; values?: UiValues }) {
  const { t } = useAppPreferences();
  return <>{t(source, values)}</>;
}

const CONTROL_COPY = {
  ko: { language: "언어", theme: "화면 모드", system: "시스템 설정", light: "라이트", dark: "다크" },
  en: { language: "Language", theme: "Appearance", system: "System", light: "Light", dark: "Dark" },
  zh: { language: "语言", theme: "外观", system: "跟随系统", light: "浅色", dark: "深色" },
  ja: { language: "言語", theme: "表示モード", system: "システム", light: "ライト", dark: "ダーク" },
} as const;

export function AppPreferencesControls() {
  const { locale, setLocale, theme, setTheme } = useAppPreferences();
  const copy = CONTROL_COPY[locale];
  return (
    <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
      <label className="flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-inkSoft">
        <span>{copy.language}</span>
        <select
          data-testid="locale-select"
          value={locale}
          onChange={(event) => setLocale(event.currentTarget.value as AppLocale)}
          className="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="ko">한국어</option>
          <option value="en">English</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-inkSoft">
        <span>{copy.theme}</span>
        <select
          data-testid="theme-select"
          value={theme}
          onChange={(event) => setTheme(event.currentTarget.value as ThemePreference)}
          className="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="system">{copy.system}</option>
          <option value="light">{copy.light}</option>
          <option value="dark">{copy.dark}</option>
        </select>
      </label>
    </div>
  );
}

export function FontSizeSettingsCard() {
  const preferences = useOptionalAppPreferences();
  const fontSize = preferences?.fontSize ?? "default";
  const setFontSize = preferences?.setFontSize ?? (() => {});
  const index = SUPPORTED_FONT_SIZES.indexOf(fontSize);
  const labels: Record<FontSizePreference, string> = {
    small: "작게",
    default: "기본",
    large: "크게",
    "extra-large": "매우 크게",
  };
  const step = (offset: -1 | 1) => {
    const next = SUPPORTED_FONT_SIZES[index + offset];
    if (next) setFontSize(next);
  };
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-6" aria-labelledby="font-size-heading">
      <h2 id="font-size-heading" className="text-[18px] font-bold text-ink">글자 크기</h2>
      <p className="mt-2 text-[13px] leading-6 text-inkSoft">
        단축키 안내를 포함한 앱 전체 글자를 한 단계씩 조절합니다. 선택한 크기는 이 브라우저에 저장됩니다.
      </p>
      <div className="mt-5 flex items-center gap-3" role="group" aria-label="글자 크기 조절">
        <button
          type="button"
          aria-label="글자 크기 한 단계 작게"
          disabled={index === 0}
          onClick={() => step(-1)}
          className="min-h-11 min-w-11 rounded-full border border-line bg-bg text-[18px] font-bold text-ink disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-24 text-center text-[14px] font-bold text-ink" role="status" aria-label="현재 글자 크기">
          {labels[fontSize]}
        </span>
        <button
          type="button"
          aria-label="글자 크기 한 단계 크게"
          disabled={index === SUPPORTED_FONT_SIZES.length - 1}
          onClick={() => step(1)}
          className="min-h-11 min-w-11 rounded-full border border-line bg-bg text-[18px] font-bold text-ink disabled:opacity-40"
        >
          +
        </button>
      </div>
    </section>
  );
}
