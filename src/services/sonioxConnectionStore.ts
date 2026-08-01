// Authoritative, event-driven Soniox realtime WebSocket connection state.
//
// This is a small pure external store / state machine. Connection truth is
// derived ONLY from real lifecycle events published by `connectSonioxRealtime`
// (WebSocket open + config-send boundary → connected; close/error/abort/finish
// terminal → disconnected). It never infers "connected" from configuration
// presence or from periodic health polling (ADR 0024 keeps the config-presence
// signal separate; see healthStatus.ts).
//
// Every connection attempt is a distinct monotonic session ("generation").
// Events carry (session, sequence) so the store can suppress duplicate, stale,
// out-of-order, and delayed old-session events: once a newer session begins, any
// trailing event from an older session is ignored, so a late close/connected can
// never resurrect a stale state.

export type SonioxConnectionStatus = "disconnected" | "connecting" | "connected";

export interface SonioxConnectionSnapshot {
  status: SonioxConnectionStatus;
  /** Monotonic session id. 0 means no session has ever started. */
  session: number;
}

export interface SonioxConnectionEvent {
  session: number;
  sequence: number;
  status: SonioxConnectionStatus;
}

/** Per-session publisher handed to a single `connectSonioxRealtime` attempt. */
export interface SonioxSessionPublisher {
  readonly session: number;
  connecting(): void;
  connected(): void;
  disconnected(): void;
}

export interface SonioxConnectionStore {
  getSnapshot(): SonioxConnectionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Allocate a new session, publish an optimistic "connecting", return its publisher. */
  beginSession(): SonioxSessionPublisher;
  /** Low-level apply — exposed for deterministic testing of suppression semantics. */
  apply(event: SonioxConnectionEvent): void;
  reset(): void;
}

export function createSonioxConnectionStore(): SonioxConnectionStore {
  let snapshot: SonioxConnectionSnapshot = { status: "disconnected", session: 0 };
  let activeSession = 0;
  let lastSequence = 0;
  let nextSession = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const apply = (event: SonioxConnectionEvent) => {
    // Older session than the one currently in charge → stale, ignore.
    if (event.session < activeSession) return;
    // Same session but not newer than what we've already seen → duplicate/out-of-order.
    if (event.session === activeSession && event.sequence <= lastSequence) return;
    if (event.session > activeSession) activeSession = event.session;
    lastSequence = event.sequence;
    if (snapshot.status === event.status && snapshot.session === activeSession) return;
    snapshot = { status: event.status, session: activeSession };
    notify();
  };

  const beginSession = (): SonioxSessionPublisher => {
    const session = ++nextSession;
    let sequence = 0;
    const publish = (status: SonioxConnectionStatus) =>
      apply({ session, sequence: ++sequence, status });
    publish("connecting");
    return {
      session,
      connecting: () => publish("connecting"),
      connected: () => publish("connected"),
      disconnected: () => publish("disconnected"),
    };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginSession,
    apply,
    reset: () => {
      activeSession = 0;
      lastSequence = 0;
      nextSession = 0;
      snapshot = { status: "disconnected", session: 0 };
      notify();
    },
  };
}

/** App-wide singleton. Persists across client navigations, like the health store. */
export const sonioxConnectionStore = createSonioxConnectionStore();
