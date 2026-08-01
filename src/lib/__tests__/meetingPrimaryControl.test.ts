// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  resolveMeetingPrimaryControl,
  type MeetingPrimaryInput,
} from "@/lib/meetingPrimaryControl";

function input(overrides: Partial<MeetingPrimaryInput> = {}): MeetingPrimaryInput {
  return {
    active: false,
    captureListening: false,
    hasUnsavedEntries: false,
    pushToTalkPhase: "idle",
    speechPhase: "idle",
    saving: false,
    ...overrides,
  };
}

describe("resolveMeetingPrimaryControl", () => {
  it("offers 미팅 시작 when idle with no unsaved conversation", () => {
    expect(resolveMeetingPrimaryControl(input())).toEqual({
      kind: "start",
      label: "미팅 시작",
      disabled: false,
    });
  });

  it("offers 회의록 저장 계속 when idle but an unsaved conversation remains", () => {
    expect(resolveMeetingPrimaryControl(input({ hasUnsavedEntries: true }))).toEqual({
      kind: "reopen",
      label: "회의록 저장 계속",
      disabled: false,
    });
  });

  it("offers the push-to-talk start control while a meeting is listening", () => {
    expect(resolveMeetingPrimaryControl(input({ active: true, captureListening: true }))).toEqual({
      kind: "ptt-start",
      label: "송출 구간 시작",
      disabled: false,
    });
  });

  it("switches to 송출 구간 확정 while recording a push-to-talk segment", () => {
    const control = resolveMeetingPrimaryControl(input({
      active: true,
      captureListening: true,
      pushToTalkPhase: "recording",
    }));
    expect(control).toEqual({ kind: "ptt-confirm", label: "송출 구간 확정", disabled: false });
  });

  it("disables the push-to-talk control while not listening (e.g. paused)", () => {
    const control = resolveMeetingPrimaryControl(input({ active: true, captureListening: false }));
    expect(control?.kind).toBe("ptt-start");
    expect(control?.disabled).toBe(true);
  });

  it("disables the push-to-talk control while a segment is being translated or spoken", () => {
    for (const phase of ["finalizing", "translating", "speaking"] as const) {
      const control = resolveMeetingPrimaryControl(input({
        active: true,
        captureListening: true,
        pushToTalkPhase: phase,
      }));
      expect(control?.disabled).toBe(true);
    }
  });

  it("disables the push-to-talk control while speech is connecting or playing", () => {
    for (const speechPhase of ["connecting", "playing"]) {
      const control = resolveMeetingPrimaryControl(input({
        active: true,
        captureListening: true,
        speechPhase,
      }));
      expect(control?.disabled).toBe(true);
    }
  });
});
