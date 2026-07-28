import { describe, expect, it } from "vitest";

import {
  captureSonioxShortcut,
  decodeSonioxShortcutSettings,
  DEFAULT_SONIOX_SHORTCUTS,
  encodeSonioxShortcutSettings,
  formatSonioxShortcut,
  matchSonioxShortcut,
  updateSonioxShortcut,
} from "@/lib/sonioxShortcuts";

describe("Soniox keyboard shortcuts", () => {
  it("uses browser-deliverable defaults and exact modifiers", () => {
    expect(DEFAULT_SONIOX_SHORTCUTS).toEqual({
      translator: { code: "KeyT", shift: true, alt: true, ctrl: false, meta: false },
      dictation: { code: "KeyD", shift: true, alt: true, ctrl: false, meta: false },
      translation: { code: "KeyV", shift: true, alt: true, ctrl: false, meta: false },
    });

    expect(matchSonioxShortcut(
      { code: "KeyD", key: "d", shiftKey: true, altKey: true, ctrlKey: false, metaKey: false, repeat: false },
      DEFAULT_SONIOX_SHORTCUTS.dictation,
    )).toBe(true);
    expect(matchSonioxShortcut(
      { code: "KeyD", key: "d", shiftKey: false, altKey: true, ctrlKey: false, metaKey: false, repeat: false },
      DEFAULT_SONIOX_SHORTCUTS.dictation,
    )).toBe(false);
    expect(matchSonioxShortcut(
      { code: "Fn", key: "Fn", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false },
      DEFAULT_SONIOX_SHORTCUTS.dictation,
    )).toBe(false);
  });

  it("captures a complete key combination and rejects unsupported or duplicate bindings", () => {
    const captured = captureSonioxShortcut({
      code: "KeyK",
      key: "k",
      shiftKey: true,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
    });
    expect(captured).toEqual({ code: "KeyK", shift: true, alt: true, ctrl: false, meta: false });
    expect(captureSonioxShortcut({
      code: "Fn",
      key: "Fn",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
    })).toBeNull();
    for (const key of ["Dead", "Unidentified"]) {
      expect(captureSonioxShortcut({
        code: key,
        key,
        shiftKey: false,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
      })).toBeNull();
    }
    expect(captureSonioxShortcut({
      code: "ShiftLeft",
      key: "Shift",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
    })).toBeNull();
    expect(captureSonioxShortcut({
      code: "Enter", key: "Enter", shiftKey: false, altKey: false,
      ctrlKey: false, metaKey: false, repeat: false,
    })).toBeNull();
    expect(captureSonioxShortcut({
      code: "KeyR", key: "r", shiftKey: false, altKey: false,
      ctrlKey: false, metaKey: true, repeat: false,
    })).toBeNull();
    expect(captureSonioxShortcut({
      code: "KeyW", key: "w", shiftKey: false, altKey: false,
      ctrlKey: true, metaKey: false, repeat: false,
    })).toBeNull();
    for (const [code, key, altKey, ctrlKey, metaKey] of [
      ["ArrowLeft", "ArrowLeft", true, false, false],
      ["ArrowRight", "ArrowRight", true, false, false],
      ["KeyS", "s", false, false, true],
      ["KeyP", "p", false, true, false],
      ["KeyF", "f", false, false, true],
    ] as const) {
      expect(captureSonioxShortcut({
        code, key, shiftKey: false, altKey, ctrlKey, metaKey, repeat: false,
      })).toBeNull();
    }

    expect(updateSonioxShortcut(
      DEFAULT_SONIOX_SHORTCUTS,
      "translator",
      DEFAULT_SONIOX_SHORTCUTS.dictation,
    )).toEqual({ ok: false, conflict: "dictation" });
    expect(updateSonioxShortcut(DEFAULT_SONIOX_SHORTCUTS, "translator", captured!)).toEqual({
      ok: true,
      settings: { ...DEFAULT_SONIOX_SHORTCUTS, translator: captured },
    });

    expect(updateSonioxShortcut(DEFAULT_SONIOX_SHORTCUTS, "translation", {
      code: "F8", shift: false, alt: false, ctrl: false, meta: false,
    })).toEqual({ ok: false, conflict: "dictation" });
    expect(updateSonioxShortcut(DEFAULT_SONIOX_SHORTCUTS, "dictation", {
      code: "F8", shift: true, alt: false, ctrl: false, meta: false,
    })).toEqual({ ok: false, conflict: "translation" });
    expect(updateSonioxShortcut(DEFAULT_SONIOX_SHORTCUTS, "translator", {
      code: "F8", shift: false, alt: false, ctrl: false, meta: false,
    })).toEqual({ ok: false, conflict: "dictation" });

    const customizedDictation = {
      ...DEFAULT_SONIOX_SHORTCUTS,
      dictation: captured!,
      translator: { code: "F8", shift: false, alt: false, ctrl: false, meta: false },
    };
    expect(updateSonioxShortcut(
      customizedDictation,
      "dictation",
      DEFAULT_SONIOX_SHORTCUTS.dictation,
    )).toEqual({ ok: false, conflict: "translator" });

    const customizedTranslation = {
      ...DEFAULT_SONIOX_SHORTCUTS,
      translation: captured!,
      translator: { code: "F8", shift: true, alt: false, ctrl: false, meta: false },
    };
    expect(updateSonioxShortcut(
      customizedTranslation,
      "translation",
      DEFAULT_SONIOX_SHORTCUTS.translation,
    )).toEqual({ ok: false, conflict: "translator" });
  });

  it("round-trips versioned settings, formats them, and recovers from invalid storage", () => {
    const custom = {
      ...DEFAULT_SONIOX_SHORTCUTS,
      dictation: { code: "KeyK", shift: true, alt: true, ctrl: false, meta: false },
    };
    expect(decodeSonioxShortcutSettings(encodeSonioxShortcutSettings(custom))).toEqual(custom);
    expect(formatSonioxShortcut(custom.dictation)).toBe("⌥ + ⇧ + K");
    expect(formatSonioxShortcut(DEFAULT_SONIOX_SHORTCUTS.translation)).toBe("⌥ + ⇧ + V");
    expect(decodeSonioxShortcutSettings(null)).toEqual(DEFAULT_SONIOX_SHORTCUTS);
    expect(decodeSonioxShortcutSettings("not-json")).toEqual(DEFAULT_SONIOX_SHORTCUTS);
    expect(decodeSonioxShortcutSettings(JSON.stringify({ version: 2, bindings: custom })))
      .toEqual(DEFAULT_SONIOX_SHORTCUTS);
    expect(decodeSonioxShortcutSettings(JSON.stringify({
      version: 1,
      bindings: { ...custom, dictation: { ...custom.dictation, code: "" } },
    }))).toEqual(DEFAULT_SONIOX_SHORTCUTS);
    expect(decodeSonioxShortcutSettings(JSON.stringify({
      version: 1,
      bindings: { ...custom, dictation: { code: "KeyR", shift: false, alt: false, ctrl: false, meta: true } },
    }))).toEqual(DEFAULT_SONIOX_SHORTCUTS);
    expect(decodeSonioxShortcutSettings(JSON.stringify({
      version: 1,
      bindings: {
        ...DEFAULT_SONIOX_SHORTCUTS,
        translator: { code: "F8", shift: false, alt: false, ctrl: false, meta: false },
      },
    }))).toEqual(DEFAULT_SONIOX_SHORTCUTS);
  });
});
