import { z } from "zod";

import { ROOM_LANGUAGES, ROOM_MODES } from "@/domain/room";
import { resolveRequestSession } from "@/lib/accountSession";
import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import { INVITE_EXPIRES_POLICY, inviteUrl, publicRoom } from "@/lib/roomApi";
import { resolveRoomRequestIdentity } from "@/lib/roomRequest";
import { createRoom } from "@/lib/roomStore";

// POST /api/rooms — a host opens a shared interpreter room (ADR 0028). The
// plain invite password exists only in this response and in a rotate response.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().max(200).optional(),
  mode: z.enum(ROOM_MODES),
  hostLanguage: z.enum(ROOM_LANGUAGES),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const identity = resolveRoomRequestIdentity(request);
  if (!identity || identity.role !== "host") return publicErrorResponse("authentication_required", 401);

  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 4 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);

  const session = await resolveRequestSession(request, "customer");
  const hostName = session?.account.name?.trim() || "호스트";

  const created = await createRoom({
    hostAccountId: identity.accountId,
    mode: parsed.data.mode,
    title: parsed.data.title ?? null,
    host: { name: hostName.slice(0, 40), language: parsed.data.hostLanguage },
  });
  return jsonNoStore({
    id: created.room.id,
    room: await publicRoom(request, created.room, identity),
    invite: {
      url: inviteUrl(request, created.invite.token),
      password: created.invite.password,
      expiresPolicy: INVITE_EXPIRES_POLICY,
    },
  });
}
