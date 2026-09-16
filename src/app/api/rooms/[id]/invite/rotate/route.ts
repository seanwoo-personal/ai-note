import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { jsonNoStore } from "@/lib/publicApi";
import { INVITE_EXPIRES_POLICY, inviteUrl, resolveRoomRequest, roomErrorResponse } from "@/lib/roomApi";
import { rotateRoomInvite } from "@/lib/roomStore";

// POST /api/rooms/[id]/invite/rotate — host only. Issues a fresh link + password
// and revokes every existing guest session for the room.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const context = await resolveRoomRequest(request, (await params).id, { requireHost: true });
  if (!context.ok) return context.response;
  try {
    const rotated = await rotateRoomInvite(context.id, { hostAccountId: context.identity.accountId });
    return jsonNoStore({
      id: context.id,
      invite: {
        url: inviteUrl(request, rotated.invite.token),
        password: rotated.invite.password,
        expiresPolicy: INVITE_EXPIRES_POLICY,
      },
    });
  } catch (error) {
    return roomErrorResponse(error, context.id);
  }
}
