import { afterEach, describe, expect, it, vi } from "vitest";

import { connectSonioxRealtime } from "@/services/sonioxRealtime";
import { createSonioxConnectionStore } from "@/services/sonioxConnectionStore";

// A minimal fake WebSocket following the repo's established pattern
// (sonioxRealtime.test.ts): a static `instance` handle the test drives manually.
class FakeWebSocket {
  static instance: FakeWebSocket | null = null;
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instance = this;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function stubTempKey() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ apiKey: "temporary-key" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
  );
  vi.stubGlobal("WebSocket", FakeWebSocket);
}

async function connectOpened(store: ReturnType<typeof createSonioxConnectionStore>) {
  const connecting = connectSonioxRealtime({
    translation: { mode: "none" },
    onTranscript: () => {},
    connection: store.beginSession(),
  });
  await vi.waitFor(() => expect(FakeWebSocket.instance).not.toBeNull());
  FakeWebSocket.instance!.open();
  const session = await connecting;
  return { session, socket: FakeWebSocket.instance! };
}

describe("connectSonioxRealtime — authoritative connection publication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWebSocket.instance = null;
  });

  it("publishes connecting on begin and connected only after open + config send", async () => {
    stubTempKey();
    const store = createSonioxConnectionStore();
    const connecting = connectSonioxRealtime({
      translation: { mode: "none" },
      onTranscript: () => {},
      connection: store.beginSession(),
    });
    // Still connecting until the WebSocket opens and config is sent.
    expect(store.getSnapshot().status).toBe("connecting");
    await vi.waitFor(() => expect(FakeWebSocket.instance).not.toBeNull());
    FakeWebSocket.instance!.open();
    await connecting;
    expect(store.getSnapshot().status).toBe("connected");
    // Config was actually sent at the boundary that flipped us to connected.
    expect(JSON.parse(String(FakeWebSocket.instance!.sent[0]))).toMatchObject({ api_key: "temporary-key" });
  });

  it("clears connected state on a runtime stream error", async () => {
    stubTempKey();
    const store = createSonioxConnectionStore();
    const { socket } = await connectOpened(store);
    expect(store.getSnapshot().status).toBe("connected");
    socket.onmessage?.({ data: JSON.stringify({ error_code: 429, error_message: "vendor detail" }) });
    expect(store.getSnapshot().status).toBe("disconnected");
  });

  it("clears connected state when the socket closes underneath us", async () => {
    stubTempKey();
    const store = createSonioxConnectionStore();
    const { socket } = await connectOpened(store);
    socket.onclose?.();
    expect(store.getSnapshot().status).toBe("disconnected");
  });

  it("clears connected state on explicit close()", async () => {
    stubTempKey();
    const store = createSonioxConnectionStore();
    const { session } = await connectOpened(store);
    session.close();
    expect(store.getSnapshot().status).toBe("disconnected");
  });

  it("keeps connected through finish() until the provider terminal response", async () => {
    stubTempKey();
    vi.useFakeTimers();
    const store = createSonioxConnectionStore();
    const { session, socket } = await connectOpened(store);
    session.finish();
    // Sending end-of-input is NOT a disconnect — the provider stream is still open.
    expect(store.getSnapshot().status).toBe("connected");
    socket.onmessage?.({ data: JSON.stringify({ finished: true }) });
    expect(store.getSnapshot().status).toBe("disconnected");
  });

  it("publishes disconnected when the socket closes before opening", async () => {
    stubTempKey();
    const store = createSonioxConnectionStore();
    const connecting = connectSonioxRealtime({
      translation: { mode: "none" },
      onTranscript: () => {},
      connection: store.beginSession(),
    });
    await vi.waitFor(() => expect(FakeWebSocket.instance).not.toBeNull());
    FakeWebSocket.instance!.onclose?.();
    await expect(connecting).rejects.toThrow("soniox_websocket_closed");
    expect(store.getSnapshot().status).toBe("disconnected");
  });

  it("rejects and disconnects when send(config) throws synchronously in onopen", async () => {
    // A socket that opens but rejects the config frame (send throws). The store
    // must not stay stuck in "connecting" — it must land on "disconnected".
    let closed = false;
    class ThrowingSendWebSocket {
      static instance: ThrowingSendWebSocket | null = null;
      static readonly OPEN = 1;
      readyState = 0;
      binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(readonly url: string) {
        ThrowingSendWebSocket.instance = this;
      }
      open() {
        this.readyState = ThrowingSendWebSocket.OPEN;
        this.onopen?.();
      }
      send() {
        throw new Error("config frame rejected");
      }
      close() {
        closed = true;
        this.readyState = 3;
        this.onclose?.();
      }
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ apiKey: "temporary-key" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    );
    vi.stubGlobal("WebSocket", ThrowingSendWebSocket);
    const store = createSonioxConnectionStore();
    const connecting = connectSonioxRealtime({
      translation: { mode: "none" },
      onTranscript: () => {},
      connection: store.beginSession(),
    });
    await vi.waitFor(() => expect(ThrowingSendWebSocket.instance).not.toBeNull());
    expect(store.getSnapshot().status).toBe("connecting");
    ThrowingSendWebSocket.instance!.open(); // onopen → send(config) throws
    await expect(connecting).rejects.toThrow();
    expect(store.getSnapshot().status).toBe("disconnected");
    expect(closed).toBe(true);
  });

  it("closes the socket and disconnects when the signal aborts after connecting", async () => {
    stubTempKey();
    const store = createSonioxConnectionStore();
    const controller = new AbortController();
    const connecting = connectSonioxRealtime({
      translation: { mode: "none" },
      onTranscript: () => {},
      signal: controller.signal,
      connection: store.beginSession(),
    });
    await vi.waitFor(() => expect(FakeWebSocket.instance).not.toBeNull());
    FakeWebSocket.instance!.open();
    await connecting;
    expect(store.getSnapshot().status).toBe("connected");

    // Abort AFTER a live session — the real socket must be closed and the store
    // must drop to disconnected with no stale "connected".
    controller.abort();
    expect(store.getSnapshot().status).toBe("disconnected");
    expect(FakeWebSocket.instance!.readyState).toBe(3);
  });
});
