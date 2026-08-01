// Single source of truth for the customer-facing product brand.
//
// "Vision" is the CUSTOMER (株式会社ビジョン, a Japanese pocket Wi-Fi rental
// company), not an external AI provider. ADR 0024's vendor-neutral contract
// hides *provider* identities (the realtime STT/translation and summary API
// vendors); naming the customer's own product does not violate it (ADR 0025).
//
// Locale-invariant by design: a product name is a brand, not UI copy, so it is
// never routed through translateUi() and every surface that renders it opts out
// of the i18n MutationObserver with data-i18n-user-content.
//
// The wordmark is TYPOGRAPHY ONLY. No official Vision or GLOBAL WiFi logo asset
// is embedded — first-party evidence grants no logo-use rights and the customer
// reserves all IP (see docs/vision-rebrand-identity.md §4).

export const BRAND_NAME = "Vision";
export const BRAND_PRODUCT_NAME = "Vision AI 미팅 에이전트";
export const BRAND_TAGLINE = "AI 미팅 에이전트(AI Meeting Agent)";
export const BRAND_HOME_LABEL = `${BRAND_PRODUCT_NAME} 홈`;
