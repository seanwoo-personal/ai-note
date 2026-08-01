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
    const medium = read("public/fonts/SUIT/SUIT-Medium.woff2");
    const bold = read("public/fonts/SUIT/SUIT-Bold.woff2");
    const license = read("public/fonts/SUIT/OFL.txt").toString("utf8");

    const faces = css.match(/@font-face\s*{[^}]*}/gs) ?? [];
    const mediumFace = faces.find((face) => face.includes("SUIT-Medium.woff2"));
    const boldFace = faces.find((face) => face.includes("SUIT-Bold.woff2"));

    expect(medium.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(bold.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(mediumFace).toContain('font-family: "SUIT"');
    expect(mediumFace).toContain("font-weight: 500");
    expect(boldFace).toContain('font-family: "SUIT"');
    expect(boldFace).toContain("font-weight: 700");
    expect(css).toContain("font-family: var(--font-sans)");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("defines a complete dark-mode semantic token override", () => {
    const css = read("src/app/globals.css").toString("utf8");
    const dark = css.match(/:root\[data-theme="dark"\]\s*{[^}]*}/s)?.[0] ?? "";

    for (const token of [
      "--ld-color-bg-e1",
      "--ld-color-bg-e2",
      "--ld-color-bg-primary-e1",
      "--ld-color-bg-primary-e2",
      "--ld-color-contents",
      "--ld-color-contents-sub",
      "--ld-color-contents-disabled",
      "--ld-color-primary",
      "--ld-color-divider",
      "--ld-color-item-yellow",
      "--ld-color-danger",
    ]) expect(dark).toContain(token);

    const color = (token: string) => dark.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
    for (const [foreground, background] of [
      ["--ld-color-contents", "--ld-color-bg-e2"],
      ["--ld-color-contents-sub", "--ld-color-bg-e2"],
      ["--ld-color-primary", "--ld-color-bg-e1"],
      ["--ld-color-item-yellow", "--ld-color-bg-e2"],
      ["--ld-color-danger", "--ld-color-bg-e1"],
    ]) expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
    // Leende's disabled semantic is intentionally de-emphasized. Disabled controls
    // are not operable content under WCAG 1.4.3, but keep a measurable 3:1 floor.
    expect(contrastRatio(color("--ld-color-contents-disabled"), color("--ld-color-bg-e1"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps light warning text above WCAG AA contrast", () => {
    const css = read("src/app/globals.css").toString("utf8");
    const light = css.match(/:root\s*{[^}]*}/s)?.[0] ?? "";
    const color = (token: string) => light.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
    expect(contrastRatio(
      color("--ld-color-item-yellow"),
      color("--ld-color-bg-e2"),
    )).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every light interactive pair at WCAG AA and separates brand fill from link text", () => {
    const css = read("src/app/globals.css").toString("utf8");
    const light = css.match(/:root\s*{[^}]*}/s)?.[0] ?? "";
    const color = (token: string) => light.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";

    expect(color("--ld-color-primary")).toBe("#00a872");
    expect(color("--ld-color-primary-text")).not.toBe(color("--ld-color-primary"));
    for (const [foreground, background] of [
      ["--ld-color-primary-text", "--ld-color-bg-e1"],
      ["--ld-color-primary-text", "--ld-color-bg-e2"],
      ["--ld-color-contents-on", "--hej-color-action-primary-surface"],
      ["--ld-color-danger", "--ld-color-bg-e1"],
      ["--hej-color-focus-strong", "--ld-color-bg-e1"],
    ]) expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);

    expect(css).toContain(":where(a, button, input, select, textarea, [tabindex]):focus-visible");
    expect(css).toContain("outline: 3px solid var(--hej-color-focus-strong)");
  });

  it("uses only defined semantic Tailwind ring tokens in navigation", () => {
    const navigation = read("src/components/LibraryNavigation.tsx").toString("utf8");
    expect(navigation).not.toContain("ring-action");
    expect(navigation).toContain("before:ring-accent");
  });
});
