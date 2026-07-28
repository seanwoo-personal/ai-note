// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppPreferencesControls,
  AppPreferencesProvider,
  LocalizedText,
  useAppPreferences,
} from "@/components/AppPreferences";

function Probe() {
  const preferences = useAppPreferences();
  return <output data-testid="preferences">{preferences.locale}:{preferences.theme}:{preferences.resolvedTheme}:{preferences.brandName}</output>;
}

describe("AppPreferencesProvider", () => {
  let dark = false;
  let listener: ((event: MediaQueryListEvent) => void) | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.lang = "ko";
    dark = false;
    listener = null;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: dark,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => { listener = next; },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores persisted locale and theme and applies them to the document", async () => {
    window.localStorage.setItem("ai-note-locale", "en");
    window.localStorage.setItem("ai-note-theme", "dark");

    render(<AppPreferencesProvider><AppPreferencesControls /><LocalizedText source="헤이홈 AI 기록도구" /><Probe /></AppPreferencesProvider>);

    await waitFor(() => expect(screen.getByTestId("preferences")).toHaveTextContent("en:dark:dark:Hejhome"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByTestId("locale-select")).toHaveValue("en");
    expect(screen.getByTestId("theme-select")).toHaveValue("dark");
    expect(screen.getByText("Hejhome AI Notes")).toBeInTheDocument();
    expect(document.title).toBe("Hejhome AI Notes");
    document.title = "AI NOTE";
    await waitFor(() => expect(document.title).toBe("Hejhome AI Notes"));
  });

  it("localizes registered fixed DOM copy while preserving marked user content", async () => {
    window.localStorage.setItem("ai-note-locale", "en");
    render(
      <AppPreferencesProvider>
        <AppPreferencesControls />
        <span data-testid="fixed-copy">설정</span>
        <span data-testid="user-copy" data-i18n-user-content>설정</span>
        <input data-testid="fixed-input" aria-label="회의 검색" placeholder="검색" />
        <button data-testid="user-attribute" data-i18n-user-attributes title="설정">folder</button>
      </AppPreferencesProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("fixed-copy")).toHaveTextContent("Settings"));
    expect(screen.getByTestId("user-copy")).toHaveTextContent("설정");
    expect(screen.getByTestId("fixed-input")).toHaveAttribute("aria-label", "Search meetings");
    expect(screen.getByTestId("fixed-input")).toHaveAttribute("placeholder", "Search");
    expect(screen.getByTestId("user-attribute")).toHaveAttribute("title", "설정");

    fireEvent.change(screen.getByTestId("locale-select"), { target: { value: "ja" } });
    await waitFor(() => expect(screen.getByTestId("fixed-copy")).toHaveTextContent("設定"));
    expect(screen.getByTestId("user-copy")).toHaveTextContent("설정");
  });

  it("persists user changes and follows OS changes only in system mode", async () => {
    render(<AppPreferencesProvider><AppPreferencesControls /><Probe /></AppPreferencesProvider>);

    fireEvent.change(screen.getByTestId("locale-select"), { target: { value: "ja" } });
    fireEvent.change(screen.getByTestId("theme-select"), { target: { value: "system" } });
    expect(window.localStorage.getItem("ai-note-locale")).toBe("ja");
    expect(window.localStorage.getItem("ai-note-theme")).toBe("system");
    expect(document.documentElement).toHaveAttribute("lang", "ja");

    dark = true;
    act(() => listener?.({ matches: true } as MediaQueryListEvent));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(screen.getByTestId("preferences")).toHaveTextContent("ja:system:dark:Hejhome");
  });

  it("keeps preferences usable in memory when browser storage is denied", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    render(<AppPreferencesProvider><AppPreferencesControls /><Probe /></AppPreferencesProvider>);
    await waitFor(() => expect(screen.getByTestId("preferences")).toHaveTextContent("en:system:light:Hejhome"));

    expect(() => {
      fireEvent.change(screen.getByTestId("locale-select"), { target: { value: "ja" } });
      fireEvent.change(screen.getByTestId("theme-select"), { target: { value: "dark" } });
    }).not.toThrow();
    await waitFor(() => expect(screen.getByTestId("preferences")).toHaveTextContent("ja:dark:dark:Hejhome"));
    expect(document.documentElement).toHaveAttribute("lang", "ja");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("uses the browser locale when a stored locale is corrupt", async () => {
    window.localStorage.setItem("ai-note-locale", "fr");
    render(<AppPreferencesProvider><Probe /></AppPreferencesProvider>);
    await waitFor(() => expect(screen.getByTestId("preferences")).toHaveTextContent("en:system:light:Hejhome"));
  });
});
