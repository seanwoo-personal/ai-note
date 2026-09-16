import type { RoomEvent } from "@/domain/room";

// In-process fan-out for shared interpreter rooms. Appends to the durable
// event log publish here; SSE subscribers receive live events after replaying
// what they missed from the log. One Node server, one hub (ADR 0028 §8).

type Listener = (event: RoomEvent) => void;

declare global {
  var __aiNoteRoomEventHub: Map<string, Set<Listener>> | undefined;
}

function rooms(): Map<string, Set<Listener>> {
  globalThis.__aiNoteRoomEventHub ??= new Map();
  return globalThis.__aiNoteRoomEventHub;
}

export function subscribeRoomEvents(roomKey: string, listener: Listener): () => void {
  const listeners = rooms().get(roomKey) ?? new Set<Listener>();
  listeners.add(listener);
  rooms().set(roomKey, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && rooms().get(roomKey) === listeners) rooms().delete(roomKey);
  };
}

export function publishRoomEvent(roomKey: string, event: RoomEvent): void {
  const listeners = rooms().get(roomKey);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A broken subscriber must not stop delivery to the others.
    }
  }
}

export function roomSubscriberCount(roomKey: string): number {
  return rooms().get(roomKey)?.size ?? 0;
}

export function resetRoomEventHubForTests(): void {
  globalThis.__aiNoteRoomEventHub = new Map();
}
