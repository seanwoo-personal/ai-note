import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

// Brand lockup: the customer's logo over the product tagline.
//
// The logo is served from `public/brand/` so the shell never reaches the network
// and works offline like the rest of the app. It is the customer's registered
// mark, so it is rendered as supplied — never recolored, stretched, or traced
// (see docs/vision-rebrand-identity.md §4 and ADR 0025).
//
// data-i18n-user-content marks the whole lockup as brand content, which excludes
// both its text nodes AND its attributes — including the logo's `alt` — from the
// AppPreferences i18n observer, so the brand reads the same in ko/en/ja/zh.
export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span data-i18n-user-content className="flex min-w-0 flex-col items-start gap-1 leading-tight">
      {/* Plain <img>: a static local SVG needs no Image optimization pipeline.
          `self-start` keeps the mark at its own width — a stretched flex item
          would distort a logo that must never be reshaped. */}
      <img
        src="/brand/vision-logo.svg"
        alt={BRAND_NAME}
        width={180}
        height={58}
        className={`w-auto shrink-0 self-start ${compact ? "h-[26px]" : "h-[30px]"}`}
      />
      <span className="truncate text-[11px] font-semibold tracking-[0.06em] text-inkSoft">{BRAND_TAGLINE}</span>
    </span>
  );
}
