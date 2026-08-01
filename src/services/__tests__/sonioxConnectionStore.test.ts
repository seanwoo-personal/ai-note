import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSonioxConnectionStore,
  type SonioxConnectionSnapshot,
} from "@/services/sonioxConnectionStore";

describe("sonioxConnectionStore — authoritative event-driven connection state", () => {
  let store: ReturnType<typeof createSonioxConnectionStore>;

  beforeEach(() => {
    store = createSonioxConnectionStore();
  });

  it("starts disconnected with no session (initial snapshot)", () => {
    expect(store.getSnapshot()).toEqual<SonioxConnectionSnapshot>({
      status: "disconnected",
      session: 0,
    });
  });

  it("marks connecting when a session begins and connected only at the config-send boundary", () => {
    const session = store.beginSession();
    // beginSession publishes an optimistic connecting state (WS not open yet).
    expect(store.getSnapshot()).toEqual({ status: "connecting", session: session.session });
    session.connected();
    expect(store.getSnapshot()).toEqual({ status: "connected", session: session.session });
  });

  it("transitions connected → disconnected on the same session", () => {
    const session = store.beginSession();
    session.connected();
    session.disconnected();
    expect(store.getSnapshot()).toEqual({ status: "disconnected", session: session.session });
  });

  it("reconnects with a new session after a disconnect (disconnected → new-session connected)", () => {
    const first = store.beginSession();
    first.connected();
    first.disconnected();
    expect(store.getSnapshot().status).toBe("disconnected");

    const second = store.beginSession();
    expect(second.session).toBeGreaterThan(first.session);
    expect(store.getSnapshot()).toEqual({ status: "connecting", session: second.session });
    second.connected();
    expect(store.getSnapshot()).toEqual({ status: "connected", session: second.session });
  });

  it("suppresses duplicate events (same session + sequence)", () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.apply({ session: 1, sequence: 1, status: "connecting" });
    store.apply({ session: 1, sequence: 2, status: "connected" });
    const before = listener.mock.calls.length;
    store.apply({ session: 1, sequence: 2, status: "connected" }); // exact duplicate
    expect(listener.mock.calls.length).toBe(before);
    expect(store.getSnapshot()).toEqual({ status: "connected", session: 1 });
  });

  it("suppresses stale events from an older session after a newer one began", () => {
    const first = store.beginSession();
    first.connected();
    const second = store.beginSession(); // active session advances
    // A delayed close from the OLD session must not overwrite the new session.
    first.disconnected();
    expect(store.getSnapshot()).toEqual({ status: "connecting", session: second.session });
  });

  it("suppresses out-of-order events within a session (lower sequence ignored)", () => {
    store.apply({ session: 3, sequence: 5, status: "connected" });
    store.apply({ session: 3, sequence: 3, status: "disconnected" }); // arrives late, lower seq
    expect(store.getSnapshot()).toEqual({ status: "connected", session: 3 });
  });

  it("suppresses a delayed old-session connected event that arrives after a new session connected", () => {
    const first = store.beginSession();
    const second = store.beginSession();
    second.connected();
    // Old session's optimistic "connected" lands late — must be ignored.
    first.connected();
    expect(store.getSnapshot()).toEqual({ status: "connected", session: second.session });
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const session = store.beginSession();
    session.connected();
    expect(listener.mock.calls.length).toBeGreaterThan(0);
    unsubscribe();
    const after = listener.mock.calls.length;
    session.disconnected();
    expect(listener.mock.calls.length).toBe(after);
  });

  it("does not notify when an event leaves the snapshot unchanged", () => {
    const session = store.beginSession();
    session.connected();
    const listener = vi.fn();
    store.subscribe(listener);
    session.connected(); // still connected on the same session → no snapshot change
    expect(listener).not.toHaveBeenCalled();
  });

  it("reset() returns to the initial disconnected snapshot", () => {
    const session = store.beginSession();
    session.connected();
    store.reset();
    expect(store.getSnapshot()).toEqual({ status: "disconnected", session: 0 });
  });

  it("reset() fences outstanding publishers instead of rewinding the session counter", () => {
    const stale = store.beginSession();
    stale.connected();
    store.reset();

    // reset() is a hard fence, not a rewind: a publisher that was live before
    // the reset must never resurrect state afterwards. Rewinding the counter
    // would let its next event reuse a session id the store treats as new.
    stale.connected();
    stale.disconnected();
    expect(store.getSnapshot()).toEqual({ status: "disconnected", session: 0 });

    // A genuinely new session after the reset still takes charge.
    const fresh = store.beginSession();
    expect(fresh.session).toBeGreaterThan(stale.session);
    expect(store.getSnapshot()).toEqual({ status: "connecting", session: fresh.session });
    stale.disconnected(); // still fenced, even against the new session
    expect(store.getSnapshot()).toEqual({ status: "connecting", session: fresh.session });
  });
});
