import type { RoomEvent } from "@/domain/room";
import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { resolveRoomRequest } from "@/lib/roomApi";
import { subscribeRoomEvents } from "@/lib/roomEventHub";
import { readRoomEvents, roomPaths } from "@/lib/roomStore";

// GET /api/rooms/[id]/events — Server-Sent Events. Replays everything after
// `Last-Event-ID` (or `?after=`) from the durable log, then streams live events
// from the in-process hub. A comment heartbeat keeps the tunnel connection warm.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_EVENTS_HEARTBEAT_MS = 15_000;

function encodeEvent(event: RoomEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseAfter(request: Request): number {
  const header = request.headers.get("last-event-id");
  const query = new URL(request.url).searchParams.get("after");
  const raw = header ?? query ?? "0";
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const context = await resolveRoomRequest(request, (await params).id);
  if (!context.ok) return context.response;

  const after = parseAfter(request);
  const replay = await readRoomEvents(context.id, { afterSeq: after });
  const roomKey = roomPaths(context.id).events;
  const encoder = new TextEncoder();
  let lastSeq = after;
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Closed by the client; the abort handler releases everything.
        }
      };
      send(`retry: 3000\n\n`);
      for (const event of replay.events) {
        lastSeq = event.seq;
        send(encodeEvent(event));
      }
      if (replay.corrupt) send(`event: log_corrupt\ndata: {}\n\n`);
      const unsubscribe = subscribeRoomEvents(roomKey, (event) => {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        send(encodeEvent(event));
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), ROOM_EVENTS_HEARTBEAT_MS);
      heartbeat.unref?.();
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", () => cleanup?.(), { once: true });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
