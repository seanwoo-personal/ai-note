import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GUIDE_LANGUAGE_SPECS = [
  { locale: "ja", label: "日本語", href: "/customer-guide.html" },
  { locale: "en", label: "English", href: "/customer-guide-en.html" },
  { locale: "ko", label: "한국어", href: "/customer-guide-ko.html" },
];

const translations = JSON.parse(readFileSync(
  join(import.meta.dirname, "customer-guide-translations.json"),
  "utf8",
));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function languageSwitcher(locale) {
  const label = locale === "ja" ? "言語" : locale === "en" ? "Language" : "언어";
  const links = GUIDE_LANGUAGE_SPECS.map((spec) => (
    `<a href="${spec.href}" lang="${spec.locale}"${spec.locale === locale ? ' aria-current="page"' : ""}>${spec.label}</a>`
  )).join("");
  return `<nav class="guide-languages" aria-label="${label}">${links}</nav>`;
}

export function localizeCustomerGuide(sourceHtml, locale) {
  if (!GUIDE_LANGUAGE_SPECS.some((spec) => spec.locale === locale)) {
    throw new Error("unsupported_guide_locale");
  }
  let html = sourceHtml.replace('<html lang="ko">', `<html lang="${locale}">`);
  if (locale === "ko") {
    return html.replace("<!-- GUIDE_LANGUAGE_SWITCHER -->", languageSwitcher(locale));
  }

  const catalog = translations[locale];
  if (!catalog || typeof catalog !== "object") throw new Error("guide_catalog_missing");
  const sources = Object.keys(catalog).sort((left, right) => right.length - left.length);
  for (const source of sources) {
    const translated = catalog[source];
    if (typeof translated !== "string" || !translated.trim()) {
      throw new Error("guide_translation_invalid");
    }
    html = html.replace(new RegExp(escapeRegExp(source), "gu"), translated);
  }
  return html.replace("<!-- GUIDE_LANGUAGE_SWITCHER -->", languageSwitcher(locale));
}
