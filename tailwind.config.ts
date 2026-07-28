import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--hej-color-background-canvas)",
        panel: "var(--hej-color-background-surface)",
        soft: "var(--hej-color-background-subtle)",
        chrome: "var(--hej-color-background-navigation)",
        ink: "var(--hej-color-text-primary)",
        inkSoft: "var(--hej-color-text-secondary)",
        inkFaint: "var(--hej-color-text-disabled)",
        accent: "var(--hej-color-action-primary)",
        brand: "var(--hej-color-brand-green)",
        line: "var(--hej-color-border-default)",
        success: "var(--hej-color-status-success)",
        successBg: "var(--hej-color-status-success-surface)",
        warn: "var(--hej-color-status-warning)",
        warnBg: "var(--hej-color-status-warning-surface)",
        error: "var(--hej-color-status-error)",
      },
      fontFamily: {
        sans: ["var(--font-suit)"],
        mono: ["var(--font-mono)"],
      },
      fontWeight: {
        normal: "500",
        medium: "500",
        semibold: "700",
        bold: "700",
      },
    },
  },
  plugins: [],
};

export default config;
