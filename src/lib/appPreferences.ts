export const SUPPORTED_LOCALES = ["ko", "en", "zh", "ja"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const SUPPORTED_THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof SUPPORTED_THEMES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const SUPPORTED_FONT_SIZES = ["small", "default", "large", "extra-large"] as const;
export type FontSizePreference = (typeof SUPPORTED_FONT_SIZES)[number];

export const APP_PREFERENCES_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.documentElement;var g=function(k){try{return localStorage.getItem(k)}catch(e){return null}};var t=g('ai-note-theme');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';var m=false;try{m=matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}var d=t==='dark'||(t==='system'&&m);r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-preference',t);r.style.colorScheme=d?'dark':'light';var f=g('ai-note-font-size');if(f!=='small'&&f!=='default'&&f!=='large'&&f!=='extra-large')f='default';r.setAttribute('data-font-size',f);var l=g('ai-note-locale');if(l!=='ko'&&l!=='en'&&l!=='zh'&&l!=='ja'){var n=(navigator.language||'ko').toLowerCase().split('-')[0];l=n==='ko'||n==='en'||n==='zh'||n==='ja'?n:'ko'}}catch(e){try{document.documentElement.setAttribute('data-font-size','default')}catch(x){}}})();`;

export function parseLocale(value: string | null | undefined): AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale) ? value as AppLocale : "ko";
}

export function parseTheme(value: string | null | undefined): ThemePreference {
  return SUPPORTED_THEMES.includes(value as ThemePreference)
    ? value as ThemePreference
    : "system";
}

export function parseFontSize(value: string | null | undefined): FontSizePreference {
  return SUPPORTED_FONT_SIZES.includes(value as FontSizePreference)
    ? value as FontSizePreference
    : "default";
}

export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function brandNameForLocale(locale: AppLocale): "헤이홈" | "Soniox" | "Hejhome" {
  if (locale === "ko") return "헤이홈";
  return locale === "en" ? "Soniox" : "Hejhome";
}
