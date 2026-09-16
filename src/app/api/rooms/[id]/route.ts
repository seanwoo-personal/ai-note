import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { publicRoom, resolveRoomRequest } from "@/lib/roomApi";
import { jsonNoStore } from "@/lib/publicApi";

// GET /api/rooms/[id] — room metadata for the host or the room's own guest.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const context = await resolveRoomRequest(request, (await params).id);
  if (!context.ok) return context.response;
  return jsonNoStore(await publicRoom(request, context.room, context.identity));
}
