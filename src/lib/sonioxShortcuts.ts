export type SonioxShortcutAction = "translator" | "dictation" | "translation";

export interface SonioxShortcutBinding {
  code: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export type SonioxShortcutSettings = Record<SonioxShortcutAction, SonioxShortcutBinding>;

export interface SonioxShortcutKeyboardEvent {
  code: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
}

export const SONIOX_SHORTCUT_STORAGE_KEY = "heyhome-ai-recording.shortcuts.v1";

export const DEFAULT_SONIOX_SHORTCUTS: SonioxShortcutSettings = {
  translator: { code: "KeyT", shift: true, alt: true, ctrl: false, meta: false },
  dictation: { code: "KeyD", shift: true, alt: true, ctrl: false, meta: false },
  translation: { code: "KeyV", shift: true, alt: true, ctrl: false, meta: false },
};

export function matchSonioxShortcut(
  event: SonioxShortcutKeyboardEvent,
  binding: SonioxShortcutBinding,
): boolean {
  return !event.repeat
    && !event.isComposing
    && event.code === binding.code
    && event.shiftKey === binding.shift
    && event.altKey === binding.alt
    && event.ctrlKey === binding.ctrl
    && event.metaKey === binding.meta;
}

const UNSUPPORTED_CODES = new Set([
  "AltLeft", "AltRight", "ControlLeft", "ControlRight", "Fn", "MetaLeft", "MetaRight",
  "ShiftLeft", "ShiftRight", "Escape", "Tab", "CapsLock", "Dead", "Unidentified",
]);

const SUPPORTED_NAMED_CODES = new Set([
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Backquote", "Backslash",
  "Backspace", "BracketLeft", "BracketRight", "Comma", "Delete", "End", "Enter",
  "Equal", "Home", "Insert", "Minus", "PageDown", "PageUp", "Period", "Quote",
  "Semicolon", "Slash", "Space",
]);

function isSupportedCode(code: string): boolean {
  return /^Key[A-Z]$/.test(code)
    || /^Digit\d$/.test(code)
    || /^F(?:[1-9]|1\d|2[0-4])$/.test(code)
    || SUPPORTED_NAMED_CODES.has(code);
}

const RESERVED_ALT_NAVIGATION_CODES = new Set([
  "ArrowLeft", "ArrowRight", "Home", "PageDown", "PageUp",
]);

function isReservedBrowserShortcut(binding: SonioxShortcutBinding): boolean {
  return binding.meta
    || binding.ctrl
    || (binding.alt && RESERVED_ALT_NAVIGATION_CODES.has(binding.code));
}

function isUsableBinding(binding: SonioxShortcutBinding): boolean {
  if (!isSupportedCode(binding.code) || UNSUPPORTED_CODES.has(binding.code)) return false;
  const functionKey = /^F(?:[1-9]|1\d|2[0-4])$/.test(binding.code);
  if (!functionKey && !binding.alt && !binding.ctrl && !binding.meta) return false;
  return !isReservedBrowserShortcut(binding);
}

export function captureSonioxShortcut(
  event: SonioxShortcutKeyboardEvent,
): SonioxShortcutBinding | null {
  if (event.repeat || event.isComposing || UNSUPPORTED_CODES.has(event.code)) return null;
  const binding = {
    code: event.code,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
  };
  return isUsableBinding(binding) ? binding : null;
}

function sameBinding(left: SonioxShortcutBinding, right: SonioxShortcutBinding): boolean {
  return left.code === right.code
    && left.shift === right.shift
    && left.alt === right.alt
    && left.ctrl === right.ctrl
    && left.meta === right.meta;
}

const LEGACY_VOICE_TYPING_SHORTCUTS: Partial<Record<SonioxShortcutAction, SonioxShortcutBinding>> = {
  dictation: { code: "F8", shift: false, alt: false, ctrl: false, meta: false },
  translation: { code: "F8", shift: true, alt: false, ctrl: false, meta: false },
};

export function hasDefaultSonioxShortcut(
  settings: SonioxShortcutSettings,
  action: SonioxShortcutAction,
): boolean {
  return sameBinding(settings[action], DEFAULT_SONIOX_SHORTCUTS[action]);
}

function effectiveBindings(
  settings: SonioxShortcutSettings,
  action: SonioxShortcutAction,
): SonioxShortcutBinding[] {
  const legacyBinding = LEGACY_VOICE_TYPING_SHORTCUTS[action];
  return legacyBinding && hasDefaultSonioxShortcut(settings, action)
    ? [settings[action], legacyBinding]
    : [settings[action]];
}

function findEffectiveShortcutConflict(
  settings: SonioxShortcutSettings,
  action: SonioxShortcutAction,
  binding: SonioxShortcutBinding,
): SonioxShortcutAction | undefined {
  const prospective = { ...settings, [action]: binding };
  const actionBindings = effectiveBindings(prospective, action);
  const actions = Object.keys(prospective) as SonioxShortcutAction[];
  return actions.find((candidate) => candidate !== action && actionBindings.some(
    (actionBinding) => effectiveBindings(prospective, candidate).some(
      (candidateBinding) => sameBinding(actionBinding, candidateBinding),
    ),
  ));
}

export function updateSonioxShortcut(
  settings: SonioxShortcutSettings,
  action: SonioxShortcutAction,
  binding: SonioxShortcutBinding,
): { ok: true; settings: SonioxShortcutSettings } | { ok: false; conflict: SonioxShortcutAction } {
  const conflict = findEffectiveShortcutConflict(settings, action, binding);
  return conflict
    ? { ok: false, conflict }
    : { ok: true, settings: { ...settings, [action]: binding } };
}

function isBinding(value: unknown): value is SonioxShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  if (typeof binding.code !== "string"
    || !["shift", "alt", "ctrl", "meta"].every((key) => typeof binding[key] === "boolean")) return false;
  return isUsableBinding(binding as unknown as SonioxShortcutBinding);
}

export function encodeSonioxShortcutSettings(settings: SonioxShortcutSettings): string {
  return JSON.stringify({ version: 1, bindings: settings });
}

export function decodeSonioxShortcutSettings(value: string | null): SonioxShortcutSettings {
  if (!value) return DEFAULT_SONIOX_SHORTCUTS;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; bindings?: Record<string, unknown> };
    if (parsed.version !== 1 || !parsed.bindings) return DEFAULT_SONIOX_SHORTCUTS;
    const actions: SonioxShortcutAction[] = ["translator", "dictation", "translation"];
    if (!actions.every((action) => isBinding(parsed.bindings?.[action]))) return DEFAULT_SONIOX_SHORTCUTS;
    const settings = parsed.bindings as unknown as SonioxShortcutSettings;
    const unique = actions.every((action, index) => (
      actions.slice(index + 1).every((candidate) => !sameBinding(settings[action], settings[candidate]))
    ));
    const effectiveUnique = actions.every((action) => (
      !findEffectiveShortcutConflict(settings, action, settings[action])
    ));
    return unique && effectiveUnique ? settings : DEFAULT_SONIOX_SHORTCUTS;
  } catch {
    return DEFAULT_SONIOX_SHORTCUTS;
  }
}

function formatCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  return code;
}

export function formatSonioxShortcut(binding: SonioxShortcutBinding): string {
  return [
    binding.ctrl ? "⌃" : null,
    binding.alt ? "⌥" : null,
    binding.shift ? "⇧" : null,
    binding.meta ? "⌘" : null,
    formatCode(binding.code),
  ].filter(Boolean).join(" + ");
}
