import { describe, expect, it } from "vitest";

import {
  buildSonioxToolHref,
  formatVoiceTypingText,
  resolveSonioxWorkspaceSelection,
  resolveVoiceTypingShortcut,
} from "@/lib/sonioxWorkspace";

describe("Soniox Voice Typing legacy shortcuts", () => {
  it("maps Fn and the web fallback F8 to dictation or translation toggles", () => {
    expect(resolveVoiceTypingShortcut({ key: "Fn", shiftKey: false, repeat: false })).toBe("dictation");
    expect(resolveVoiceTypingShortcut({ key: "Fn", shiftKey: true, repeat: false })).toBe("translation");
    expect(resolveVoiceTypingShortcut({ key: "F8", shiftKey: false, repeat: false })).toBe("dictation");
    expect(resolveVoiceTypingShortcut({ key: "F8", shiftKey: true, repeat: false })).toBe("translation");
  });

  it("ignores repeated, modified, and unrelated key presses", () => {
    expect(resolveVoiceTypingShortcut({ key: "Fn", shiftKey: false, repeat: true })).toBeNull();
    expect(resolveVoiceTypingShortcut({ key: "F8", shiftKey: false, repeat: false, metaKey: true })).toBeNull();
    expect(resolveVoiceTypingShortcut({ key: "Enter", shiftKey: false, repeat: false })).toBeNull();
  });
});

describe("Voice Typing cleanup", () => {
  it("removes common fillers, adjacent repetitions, and stray punctuation spacing", () => {
    expect(formatVoiceTypingText("음, 오늘 오늘 회의는 어, 오후 세 시에 시작합니다 .")).toBe(
      "오늘 회의는 오후 세 시에 시작합니다.",
    );
    expect(formatVoiceTypingText("Um, please please send the report .")).toBe(
      "please send the report.",
    );
  });

  it("preserves the transcript when cleanup is disabled", () => {
    expect(formatVoiceTypingText("음, 원문 원문", { enabled: false })).toBe("음, 원문 원문");
  });
});

describe("Soniox workspace routing", () => {
  const library = {
    defaultWorkspaceId: "workspace-a",
    workspaces: [{ id: "workspace-a" }, { id: "workspace-b" }],
    folders: [
      { id: "folder-a", workspaceId: "workspace-a" },
      { id: "folder-b", workspaceId: "workspace-b" },
    ],
  };

  it("normalizes the retired translator deep link to the Global Meeting implementation", () => {
    expect(resolveSonioxWorkspaceSelection(
      new URLSearchParams("workspace=workspace-b&folder=folder-b&tool=translator"),
      library,
    )).toEqual({ workspaceId: "workspace-b", folderId: "folder-b", tool: "test-product" });
  });

  it("keeps the Global Meeting implementation route as the translator surface", () => {
    expect(resolveSonioxWorkspaceSelection(
      new URLSearchParams("workspace=workspace-b&folder=folder-b&tool=test-product"),
      library,
    )).toEqual({ workspaceId: "workspace-b", folderId: "folder-b", tool: "test-product" });
  });

  it("falls back to the default workspace, no folder, and transcription", () => {
    expect(resolveSonioxWorkspaceSelection(
      new URLSearchParams("workspace=missing&folder=folder-b&tool=unknown"),
      library,
    )).toEqual({ workspaceId: "workspace-a", folderId: null, tool: "transcription" });
  });

  it("builds stable links for a folder tool", () => {
    expect(buildSonioxToolHref({
      workspaceId: "workspace-a",
      folderId: "folder-a",
      tool: "voice-typing",
    })).toBe("/live?workspace=workspace-a&folder=folder-a&tool=voice-typing");
  });
});
