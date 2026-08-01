import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

// Typography-only brand lockup: the "Vision" wordmark over the product tagline.
// No logo asset is embedded (no logo-use rights — see @/lib/brand and ADR 0025).
//
// data-i18n-user-content marks the whole lockup as brand content, which excludes
// both its text nodes AND its attributes from the AppPreferences i18n observer,
// so the brand stays identical in ko/en/ja/zh.
export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span data-i18n-user-content className="flex min-w-0 flex-col leading-tight">
      <span className={`font-extrabold tracking-tight text-ink ${compact ? "text-[15px]" : "text-[16px]"}`}>
        {BRAND_NAME}
      </span>
      <span className="truncate text-[11px] font-semibold text-inkSoft">{BRAND_TAGLINE}</span>
    </span>
  );
}
