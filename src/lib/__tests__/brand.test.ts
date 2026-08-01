import { describe, expect, it } from "vitest";

import { BRAND_HOME_LABEL, BRAND_NAME, BRAND_PRODUCT_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { SUPPORTED_LOCALES } from "@/lib/appPreferences";
import { translateUi } from "@/lib/i18n";

describe("product brand", () => {
  it("uses the exact Vision customer brand strings", () => {
    expect(BRAND_NAME).toBe("Vision");
    expect(BRAND_PRODUCT_NAME).toBe("Vision AI 미팅 에이전트");
    expect(BRAND_TAGLINE).toBe("AI 미팅 에이전트(AI Meeting Agent)");
    expect(BRAND_HOME_LABEL).toBe("Vision AI 미팅 에이전트 홈");
  });

  it("stays identical in every supported locale (a brand is not UI copy)", () => {
    // Brand surfaces opt out of the i18n observer with data-i18n-user-content.
    // If a catalog ever added one of these as a translatable source, the header
    // would silently differ per locale — assert the catalogs leave them alone.
    for (const locale of SUPPORTED_LOCALES) {
      for (const brand of [BRAND_NAME, BRAND_PRODUCT_NAME, BRAND_TAGLINE, BRAND_HOME_LABEL]) {
        expect(translateUi(locale, brand), `${locale}: ${brand}`).toBe(brand);
      }
    }
  });

  it("carries no legacy product name", () => {
    const surfaces = [BRAND_NAME, BRAND_PRODUCT_NAME, BRAND_TAGLINE, BRAND_HOME_LABEL].join(" ");
    expect(surfaces).not.toMatch(/헤이홈|Hejhome|Soniox/i);
  });
});
