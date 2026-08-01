"use client";

import { useSyncExternalStore } from "react";

import {
  sonioxConnectionStore,
  type SonioxConnectionSnapshot,
} from "@/services/sonioxConnectionStore";

// App-wide, event-driven subscription to the authoritative Soniox realtime
// connection state. Unlike useHealth (a periodic poller), this hook re-renders
// synchronously on real WebSocket lifecycle events published by
// connectSonioxRealtime — never on a timer.
const SERVER_SNAPSHOT: SonioxConnectionSnapshot = { status: "disconnected", session: 0 };

export function useSonioxConnection(): SonioxConnectionSnapshot {
  return useSyncExternalStore(
    sonioxConnectionStore.subscribe,
    sonioxConnectionStore.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
