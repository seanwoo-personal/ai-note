"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  decodeSonioxShortcutSettings,
  DEFAULT_SONIOX_SHORTCUTS,
  encodeSonioxShortcutSettings,
  SONIOX_SHORTCUT_STORAGE_KEY,
  type SonioxShortcutAction,
  type SonioxShortcutBinding,
  type SonioxShortcutSettings,
  updateSonioxShortcut,
} from "@/lib/sonioxShortcuts";

export function useSonioxShortcutSettings() {
  const [settings, setSettings] = useState<SonioxShortcutSettings>(DEFAULT_SONIOX_SHORTCUTS);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const settingsRef = useRef<SonioxShortcutSettings>(DEFAULT_SONIOX_SHORTCUTS);

  useEffect(() => {
    try {
      const stored = decodeSonioxShortcutSettings(
        window.localStorage.getItem(SONIOX_SHORTCUT_STORAGE_KEY),
      );
      settingsRef.current = stored;
      setSettings(stored);
      setStorageWarning(null);
    } catch {
      settingsRef.current = DEFAULT_SONIOX_SHORTCUTS;
      setSettings(DEFAULT_SONIOX_SHORTCUTS);
      setStorageWarning("브라우저 저장소를 사용할 수 없어 단축키 변경은 현재 탭에서만 적용됩니다.");
    }
  }, []);

  const assign = useCallback((action: SonioxShortcutAction, binding: SonioxShortcutBinding) => {
    const result = updateSonioxShortcut(settingsRef.current, action, binding);
    if (!result.ok) return result;
    settingsRef.current = result.settings;
    setSettings(result.settings);
    try {
      window.localStorage.setItem(
        SONIOX_SHORTCUT_STORAGE_KEY,
        encodeSonioxShortcutSettings(result.settings),
      );
      setStorageWarning(null);
    } catch {
      setStorageWarning("브라우저 저장소를 사용할 수 없어 단축키 변경은 현재 탭에서만 적용됩니다.");
    }
    return result;
  }, []);

  const reset = useCallback(() => {
    settingsRef.current = DEFAULT_SONIOX_SHORTCUTS;
    setSettings(DEFAULT_SONIOX_SHORTCUTS);
    try {
      window.localStorage.removeItem(SONIOX_SHORTCUT_STORAGE_KEY);
      setStorageWarning(null);
    } catch {
      setStorageWarning("브라우저 저장소를 사용할 수 없어 기본값은 현재 탭에서만 복원됩니다.");
    }
  }, []);

  return { settings, settingsRef, storageWarning, assign, reset };
}
