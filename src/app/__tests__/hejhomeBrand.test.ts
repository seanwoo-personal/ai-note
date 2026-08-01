import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(join(root, "src", "app", "globals.css"), "utf8");

describe("Hejhome brand v1.0.0 integration", () => {
  it("pins the exact guide version and semantic Leende aliases", () => {
    expect(readFileSync(join(root, ".hejhome-brand-version"), "utf8").trim()).toBe("1.0.0");
    expect(css).toContain("--ld-color-primary: #00a872");
    expect(css).toContain("--ld-color-contents-on: #ffffff");
    expect(css).toContain("--hej-color-action-primary-surface: #007559");
    expect(css).toContain("background-color: var(--hej-color-action-primary-surface)");
    expect(css).toMatch(/:where\(a, button, input, select, textarea, \[tabindex\]\):focus-visible\s*\{[\s\S]*outline:\s*3px solid var\(--hej-color-focus-strong\) !important/);
    expect(css).toContain("--hej-color-brand-green: var(--ld-color-primary)");
    expect(css).toContain("--hej-color-background-canvas: var(--ld-color-bg-e2)");
    expect(css).toContain("--hej-color-status-error: var(--ld-color-danger)");
    expect(css).toContain("--ld-rd-4: 4px");
    expect(css).toContain("--ld-rd-8: 8px");
    expect(css).toContain("--ld-rd-circular: 999px");
  });

  it("ships only SUIT 500 and 700 as local browser-loadable font assets", () => {
    const medium = join(root, "public", "fonts", "SUIT", "SUIT-Medium.woff2");
    const bold = join(root, "public", "fonts", "SUIT", "SUIT-Bold.woff2");
    expect(existsSync(medium)).toBe(true);
    expect(existsSync(bold)).toBe(true);
    expect(readFileSync(medium).subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(readFileSync(bold).subarray(0, 4).toString("ascii")).toBe("wOF2");
    const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => match[1]);
    expect(faces).toHaveLength(2);
    expect(faces.map((face) => face.match(/font-weight:\s*(\d+)/)?.[1]).sort()).toEqual(["500", "700"]);
    expect(css).toContain('font-family: "SUIT"');
    expect(css).toContain("font-family: var(--font-sans)");
    expect(css).toMatch(/button,[\s\S]*textarea\s*\{[\s\S]*font:\s*inherit/);
  });
});
