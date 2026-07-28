import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath));
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
    const [red, green, blue] = channels.map((value) => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Hejhome typography assets", () => {
  it("self-hosts SUIT 500 and 700 with the required OFL notice", () => {
    const css = read("src/app/globals.css").toString("utf8");
    const medium = read("public/fonts/SUIT/SUIT-Medium.otf");
    const bold = read("public/fonts/SUIT/SUIT-Bold.otf");
    const license = read("public/fonts/SUIT/OFL.txt").toString("utf8");

    const faces = css.match(/@font-face\s*{[^}]*}/gs) ?? [];
    const mediumFace = faces.find((face) => face.includes("SUIT-Medium.otf"));
    const boldFace = faces.find((face) => face.includes("SUIT-Bold.otf"));

    expect(medium.subarray(0, 4).toString("ascii")).toBe("OTTO");
    expect(bold.subarray(0, 4).toString("ascii")).toBe("OTTO");
    expect(mediumFace).toContain('font-family: "SUIT"');
    expect(mediumFace).toContain("font-weight: 500");
    expect(boldFace).toContain('font-family: "SUIT"');
    expect(boldFace).toContain("font-weight: 700");
    expect(css).toContain("font-family: var(--font-suit)");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license).toContain("Copyright © 2022 Sun");
  });

  it("defines a complete dark-mode semantic token override", () => {
    const css = read("src/app/globals.css").toString("utf8");
    const dark = css.match(/:root\[data-theme="dark"\]\s*{[^}]*}/s)?.[0] ?? "";

    for (const token of [
      "--hej-color-background-canvas",
      "--hej-color-background-surface",
      "--hej-color-background-subtle",
      "--hej-color-background-navigation",
      "--hej-color-text-primary",
      "--hej-color-text-secondary",
      "--hej-color-text-disabled",
      "--hej-color-action-primary",
      "--hej-color-border-default",
      "--hej-color-status-success-surface",
      "--hej-color-status-warning-surface",
    ]) expect(dark).toContain(token);

    const color = (token: string) => dark.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
    for (const [foreground, background] of [
      ["--hej-color-text-primary", "--hej-color-background-canvas"],
      ["--hej-color-text-secondary", "--hej-color-background-canvas"],
      ["--hej-color-text-disabled", "--hej-color-background-surface"],
      ["--hej-color-action-primary", "--hej-color-background-surface"],
      ["--hej-color-status-warning", "--hej-color-status-warning-surface"],
      ["--hej-color-status-error", "--hej-color-background-surface"],
    ]) expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps light warning text above WCAG AA contrast", () => {
    const css = read("src/app/globals.css").toString("utf8");
    const light = css.match(/:root\s*{[^}]*}/s)?.[0] ?? "";
    const color = (token: string) => light.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
    expect(contrastRatio(
      color("--hej-color-status-warning"),
      color("--hej-color-status-warning-surface"),
    )).toBeGreaterThanOrEqual(4.5);
  });

  it("uses only defined semantic Tailwind ring tokens in navigation", () => {
    const navigation = read("src/components/LibraryNavigation.tsx").toString("utf8");
    expect(navigation).not.toContain("ring-action");
    expect(navigation).toContain("before:ring-accent");
  });
});
