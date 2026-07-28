export const SUPPORTED_LOCALES = ["ko", "en", "zh", "ja"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const SUPPORTED_THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof SUPPORTED_THEMES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const APP_PREFERENCES_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.documentElement;var g=function(k){try{return localStorage.getItem(k)}catch(e){return null}};var t=g('ai-note-theme');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';var m=false;try{m=matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}var d=t==='dark'||(t==='system'&&m);r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-preference',t);r.style.colorScheme=d?'dark':'light';var l=g('ai-note-locale');if(l!=='ko'&&l!=='en'&&l!=='zh'&&l!=='ja'){var n=(navigator.language||'ko').toLowerCase().split('-')[0];l=n==='ko'||n==='en'||n==='zh'||n==='ja'?n:'ko'}r.lang=l}catch(e){}})();`;

export function parseLocale(value: string | null | undefined): AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale) ? value as AppLocale : "ko";
}

export function parseTheme(value: string | null | undefined): ThemePreference {
  return SUPPORTED_THEMES.includes(value as ThemePreference)
    ? value as ThemePreference
    : "system";
}

export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function brandNameForLocale(locale: AppLocale): "헤이홈" | "Hejhome" {
  return locale === "ko" ? "헤이홈" : "Hejhome";
}
