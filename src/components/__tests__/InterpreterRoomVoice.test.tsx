import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tts = vi.hoisted(() => ({
  prepare: vi.fn(async () => undefined),
  speak: vi.fn<(options: { text: string; language: string; voice: string }) => Promise<void>>(async () => undefined),
  stop: vi.fn(),
}));
vi.mock("@/components/useSonioxTts", () => ({
  useSonioxTts: () => ({ phase: "idle", error: null, prepare: tts.prepare, speak: tts.speak, stop: tts.stop }),
}));
vi.mock("@/components/useSonioxLiveCapture", () => ({
  useSonioxLiveCapture: () => ({
    phase: "idle", error: null, transcript: { endpointCount: 0, endpoints: [] },
    start: vi.fn(async () => undefined), stop: vi.fn(), reset: vi.fn(),
  }),
}));

import { AppPreferencesProvider } from "@/components/AppPreferences";
import { InterpreterRoom } from "@/components/InterpreterRoom";

type Listener = (event: { data: string }) => void;
const sources: FakeEventSource[] = [];
class FakeEventSource {
  listeners = new Map<string, Listener>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { sources.push(this); }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, listener); }
  close() { /* noop */ }
  emit(type: string, payload: Record<string, unknown>) { this.listeners.get(type)?.({ data: JSON.stringify(payload) }); }
}

const ROOM = {
  id: "room-1", mode: "remote", title: null, createdAt: "2026-09-25T00:00:00.000Z", endedAt: null, guestExpiresAt: null,
  autoEndAt: "2026-09-28T00:00:00.000Z",
  participants: [
    { role: "host", name: "김민수", language: "ko", registered: false },
    { role: "guest", name: "Alex", language: "en", registered: false },
  ],
  me: { role: "guest", name: "Alex", language: "en", registered: false },
};

describe("InterpreterRoom spoken interpretation", () => {
  beforeEach(() => {
    window.localStorage.setItem("ai-note-locale", "ko");
    sources.length = 0;
    tts.speak.mockClear();
    tts.prepare.mockClear();
    tts.stop.mockClear();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/rooms/room-1") return new Response(JSON.stringify(ROOM), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    if (typeof crypto.randomUUID !== "function") {
      Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "client-uuid" });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the other seat's words aloud in my language once, only while voice output is on", async () => {
    render(<AppPreferencesProvider><InterpreterRoom roomId="room-1" role="guest" /></AppPreferencesProvider>);
    await waitFor(() => expect(sources).toHaveLength(1));
    const source = sources[0];
    const base = { at: "2026-09-25T00:00:01.000Z" };

    // Before the toggle: nothing is voiced, even with a translation present.
    act(() => {
      source.emit("utterance", { ...base, seq: 1, type: "utterance", utteranceId: "u1", speaker: "host", origin: "host", sourceLanguage: "ko", original: "안녕하세요", speakerLabel: null, confidence: "high" });
      source.emit("translation", { ...base, seq: 2, type: "translation", utteranceId: "u1", language: "en", text: "Hello (live)" });
    });
    expect(tts.speak).not.toHaveBeenCalled();

    const toggle = screen.getByRole("button", { name: "통역 음성 듣기" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(tts.prepare).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "통역 음성 끄기" })).toHaveAttribute("aria-pressed", "true");

    act(() => {
      source.emit("utterance", { ...base, seq: 3, type: "utterance", utteranceId: "u2", speaker: "host", origin: "host", sourceLanguage: "ko", original: "회의를 시작합시다.", speakerLabel: null, confidence: "high" });
    });
    expect(tts.speak).not.toHaveBeenCalled();
    act(() => {
      source.emit("translation", { ...base, seq: 4, type: "translation", utteranceId: "u2", language: "en", text: "Let's start the meeting." });
    });
    await waitFor(() => expect(tts.speak).toHaveBeenCalledTimes(1));
    expect(tts.speak).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Let's start the meeting.", language: "en", voice: "Maya" }));

    // A refined translation for the same utterance and my own words are not voiced.
    act(() => {
      source.emit("translation", { ...base, seq: 5, type: "translation", utteranceId: "u2", language: "en", text: "Let us begin the meeting." });
      source.emit("utterance", { ...base, seq: 6, type: "utterance", utteranceId: "mine", speaker: "guest", origin: "guest", sourceLanguage: "en", original: "Sure.", speakerLabel: null, confidence: "high" });
      source.emit("translation", { ...base, seq: 7, type: "translation", utteranceId: "mine", language: "ko", text: "네." });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tts.speak).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "통역 음성 끄기" }));
    expect(tts.stop).toHaveBeenCalled();
  });
});
