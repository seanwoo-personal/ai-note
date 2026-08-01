// Pure resolver for the Global Meeting panel's single "primary" call-to-action.
// The panel renders this control in the toolbar and mirrors it in a floating
// action when the in-flow button scrolls out of the viewport (AC8). Keeping the
// decision pure lets us unit-test every state without a DOM.

export type MeetingPrimaryKind = "start" | "reopen" | "ptt-start" | "ptt-confirm";

export type MeetingPushToTalkPhase =
  | "idle"
  | "recording"
  | "finalizing"
  | "translating"
  | "speaking"
  | "sent";

export interface MeetingPrimaryInput {
  /** A capture session exists (requesting…finishing). */
  active: boolean;
  /** Capture is actively listening (push-to-talk is only valid here). */
  captureListening: boolean;
  /** There is an unsaved in-memory conversation waiting to be saved. */
  hasUnsavedEntries: boolean;
  pushToTalkPhase: MeetingPushToTalkPhase;
  /** Current TTS phase (only "connecting"/"playing" block push-to-talk). */
  speechPhase: string;
  /** A save request is in flight. */
  saving: boolean;
}

export interface MeetingPrimaryControl {
  kind: MeetingPrimaryKind;
  label: string;
  disabled: boolean;
}

/**
 * The single most important actionable button for the current panel state.
 * Returns null only if there is genuinely no primary action to surface.
 */
export function resolveMeetingPrimaryControl(
  input: MeetingPrimaryInput,
): MeetingPrimaryControl | null {
  if (!input.active) {
    return input.hasUnsavedEntries
      ? { kind: "reopen", label: "회의록 저장 계속", disabled: false }
      : { kind: "start", label: "미팅 시작", disabled: false };
  }
  const recording = input.pushToTalkPhase === "recording";
  const disabled = !input.captureListening
    || ["finalizing", "translating", "speaking"].includes(input.pushToTalkPhase)
    || ["connecting", "playing"].includes(input.speechPhase);
  return recording
    ? { kind: "ptt-confirm", label: "송출 구간 확정", disabled }
    : { kind: "ptt-start", label: "송출 구간 시작", disabled };
}
