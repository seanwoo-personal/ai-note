import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), "utf8");

describe("Android adaptive app shell", () => {
  it("switches from a bottom navigation bar to a navigation rail at expanded width", () => {
    const css = read("src/app/globals.css");

    expect(css).toMatch(/@media \(max-width: 839px\)[\s\S]*data-android-compact-navigation/);
    expect(css).toMatch(/@media \(min-width: 840px\)[\s\S]*data-android-expanded-navigation/);
    expect(css).toContain("grid-template-columns: minmax(340px, 0.82fr) minmax(0, 1.18fr)");
  });

  it("keeps WebView content outside Android system bars", () => {
    const activity = read("android-app/app/src/main/java/com/hejhome/ainote/MainActivity.kt");

    expect(activity).toContain("WindowInsetsCompat.Type.systemBars()");
    expect(activity).toContain("ViewCompat.setOnApplyWindowInsetsListener");
  });
});
