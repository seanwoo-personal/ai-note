"use client";

import { useSyncExternalStore } from "react";

import type {
  LlmHealthState,
  SonioxHealthState,
  WhisperHealthState,
} from "@/components/healthStatus";

// Single shared health poller for the whole app. The LibraryNavigation rail
// (always mounted via the root layout), HomeClient's onboarding banner, and
// MeetingDetailView's hint all read from here, so there is exactly ONE poller
// regardless of how many components subscribe.
// Module-level state persists across client navigations (stale-while-revalidate),
// so pills never flash "확인 중" again after the first load.

const WHISPER_POLL_MS = 5000;
const LLM_POLL_MS = 10000;
const SONIOX_POLL_MS = 30000;

export interface Health {
  whisper: WhisperHealthState | null;
  llm: LlmHealthState | null;
  soniox: SonioxHealthState | null;
}

let state: Health = { whisper: null, llm: null, soniox: { kind: "checking" } };
const subscribers = new Set<() => void>();
let whisperTimer: ReturnType<typeof setInterval> | null = null;
let llmTimer: ReturnType<typeof setInterval> | null = null;
let sonioxTimer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;
const SERVER_SNAPSHOT: Health = { whisper: null, llm: null, soniox: { kind: "checking" } };
// Per-endpoint in-flight guards so a slow health call can't stack on the next
// poll tick. Reset in finally so a rejected fetch never wedges the poller.
let whisperInflight = false;
let llmInflight = false;
let sonioxInflight = false;

function emit(patch: Partial<Health>) {
  // Polls fetch a fresh object every tick even when nothing changed. Skipping
  // identical snapshots keeps subscribers (and their effects/intervals) from
  // re-rendering app-wide every few seconds.
  const changed = (Object.keys(patch) as (keyof Health)[])
    .some((key) => JSON.stringify(patch[key]) !== JSON.stringify(state[key]));
  if (!changed) return;
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

async function loadWhisper() {
  if (whisperInflight) return;
  whisperInflight = true;
  try {
    const res = await fetch("/api/whisper/health", { cache: "no-store" });
    emit({ whisper: (await res.json()) as WhisperHealthState });
  } catch {
    emit({ whisper: { connected: false } });
  } finally {
    whisperInflight = false;
  }
}

async function loadLlm() {
  if (llmInflight) return;
  llmInflight = true;
  try {
    const res = await fetch("/api/settings/llm/health", { cache: "no-store" });
    emit({ llm: (await res.json()) as LlmHealthState });
  } catch {
    // Transient — keep the last known state.
  } finally {
    llmInflight = false;
  }
}

async function loadSoniox() {
  if (sonioxInflight) return;
  sonioxInflight = true;
  try {
    const res = await fetch("/api/realtime/temporary-key", { cache: "no-store" });
    if (!res.ok) throw new Error("soniox status unavailable");
    const payload = await res.json() as { configured?: unknown };
    emit({ soniox: typeof payload.configured === "boolean"
      ? { kind: payload.configured ? "configured" : "unconfigured" }
      : { kind: "unknown" } });
  } catch {
    emit({ soniox: { kind: "unknown" } });
  } finally {
    sonioxInflight = false;
  }
}

function startPolling() {
  if (whisperTimer) return; // already running
  void loadWhisper();
  void loadLlm();
  void loadSoniox();
  whisperTimer = setInterval(() => void loadWhisper(), WHISPER_POLL_MS);
  llmTimer = setInterval(() => void loadLlm(), LLM_POLL_MS);
  sonioxTimer = setInterval(() => void loadSoniox(), SONIOX_POLL_MS);
}

function stopPolling() {
  if (whisperTimer) clearInterval(whisperTimer);
  if (llmTimer) clearInterval(llmTimer);
  if (sonioxTimer) clearInterval(sonioxTimer);
  whisperTimer = null;
  llmTimer = null;
  sonioxTimer = null;
}

function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  refCount += 1;
  startPolling();
  return () => {
    subscribers.delete(callback);
    refCount -= 1;
    if (refCount === 0) stopPolling();
  };
}

export function useHealth(): Health {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_SNAPSHOT);
}
