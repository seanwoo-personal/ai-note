export type SonioxTool = "transcription" | "translator" | "voice-typing" | "test-product";

export interface SonioxWorkspaceSelection {
  workspaceId: string;
  folderId: string | null;
  tool: SonioxTool;
}

interface SonioxLibraryLike {
  defaultWorkspaceId: string;
  workspaces: Array<{ id: string }>;
  folders: Array<{ id: string; workspaceId: string }>;
}

const SONIOX_TOOLS = new Set<SonioxTool>(["transcription", "translator", "voice-typing", "test-product"]);

export function resolveSonioxWorkspaceSelection(
  search: URLSearchParams,
  library: SonioxLibraryLike,
): SonioxWorkspaceSelection {
  const requestedWorkspaceId = search.get("workspace");
  const workspaceId = library.workspaces.some((item) => item.id === requestedWorkspaceId)
    ? requestedWorkspaceId as string
    : library.defaultWorkspaceId;
  const workspaceFolders = library.folders.filter((folder) => folder.workspaceId === workspaceId);
  const requestedFolderId = search.get("folder");
  const folderId = workspaceFolders.some((folder) => folder.id === requestedFolderId)
    ? requestedFolderId
    : null;
  const requestedTool = search.get("tool") as SonioxTool | null;
  const tool = requestedTool && SONIOX_TOOLS.has(requestedTool) ? requestedTool : "transcription";
  return { workspaceId, folderId, tool };
}

export function buildSonioxToolHref(selection: SonioxWorkspaceSelection): string {
  const search = new URLSearchParams({ workspace: selection.workspaceId });
  if (selection.folderId) search.set("folder", selection.folderId);
  search.set("tool", selection.tool);
  return `/soniox?${search.toString()}`;
}

export interface VoiceTypingFormatOptions {
  enabled?: boolean;
}

export function formatVoiceTypingText(
  text: string,
  options: VoiceTypingFormatOptions = {},
): string {
  if (options.enabled === false) return text;
  return text
    .trim()
    .replace(/(^|\s)(?:음|어|엄|uh|um|erm)(?:\s*,)?(?=\s|$)/giu, "$1")
    .replace(/(^|\s)([\p{L}\p{N}]+)(?:\s+\2)+(?=\s|[.,!?]|$)/giu, "$1$2")
    .replace(/\s+([.,!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export type VoiceTypingShortcutMode = "dictation" | "translation";

export interface VoiceTypingShortcutEvent {
  key: string;
  shiftKey: boolean;
  repeat: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function resolveVoiceTypingShortcut(
  event: VoiceTypingShortcutEvent,
): VoiceTypingShortcutMode | null {
  if (
    event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || (event.key !== "Fn" && event.key !== "F8")
  ) return null;
  return event.shiftKey ? "translation" : "dictation";
}
