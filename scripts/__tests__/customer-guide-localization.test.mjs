import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function read(name) {
  return readFileSync(join(root, "public", name), "utf8");
}

function visibleCopy(html) {
  return html
    .replace(/<nav class="guide-languages"[\s\S]*?<\/nav>/gu, "")
    .replace(/<style[\s\S]*?<\/style>/gu, "")
    .replace(/<script[\s\S]*?<\/script>/gu, "")
    .replace(/data:image\/[^"]+/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z]+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("customer guide localization", () => {
  it("publishes Japanese by default plus explicit English and Korean editions", () => {
    expect(read("customer-guide.html")).toContain('<html lang="ja">');
    expect(read("customer-guide-en.html")).toContain('<html lang="en">');
    expect(read("customer-guide-ko.html")).toContain('<html lang="ko">');
  });

  it("shows the guide language choices in Japanese, English, Korean order", () => {
    for (const name of ["customer-guide.html", "customer-guide-en.html", "customer-guide-ko.html"]) {
      const html = read(name);
      const switcher = html.match(/<nav class="guide-languages"[\s\S]*?<\/nav>/u)?.[0] ?? "";
      expect(switcher).toMatch(/日本語[\s\S]*English[\s\S]*한국어/u);
      expect(switcher).toContain('href="/customer-guide.html"');
      expect(switcher).toContain('href="/customer-guide-en.html"');
      expect(switcher).toContain('href="/customer-guide-ko.html"');
    }
  });

  it("contains complete Japanese and English visible copy without Korean leftovers", () => {
    const japanese = read("customer-guide.html");
    const english = read("customer-guide-en.html");
    expect(visibleCopy(japanese)).toContain("お客様向けクイックスタート");
    expect(visibleCopy(english)).toContain("Customer quick start");
    expect(visibleCopy(japanese)).not.toMatch(/[가-힣]/u);
    expect(visibleCopy(english)).not.toMatch(/[가-힣]/u);
  });

  it("explains how to preserve the meeting while refreshing speakers between unrelated media", () => {
    expect(read("customer-guide-ko.html")).toContain("새 영상·음원");
    expect(read("customer-guide.html")).toContain("新しい動画・音声");
    expect(read("customer-guide-en.html")).toContain("New video or audio");
  });

  it("does not expose implementation provider names in any customer edition", () => {
    for (const name of ["customer-guide.html", "customer-guide-en.html", "customer-guide-ko.html"]) {
      expect(visibleCopy(read(name))).not.toMatch(/soniox|openrouter|whisper|소니옥스|소니웍스|오픈\s*라우터/iu);
    }
  });
});
