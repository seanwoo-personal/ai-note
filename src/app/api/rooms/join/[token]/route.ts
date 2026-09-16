import { createHash } from "node:crypto";

import { z } from "zod";

import { isGuestAccessOpen, ROOM_LANGUAGES } from "@/domain/room";
import { cookieValue } from "@/lib/accountSession";
import {
  consumeRoomJoinAttempt,
  GUEST_SESSION_COOKIE,
  GuestSessionError,
  issueGuestSession,
  resolveGuestSession,
  resolveRoomInvite,
} from "@/lib/guestSession";
import {
  guardLocalApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { meetingFenceResponse } from "@/lib/meetingFence";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import { guestSessionExpiry, jsonWithGuestCookie, publicRoom } from "@/lib/roomApi";
import { joinRoomGuest, readRoom, verifyRoomPassword } from "@/lib/roomStore";
import { runWithAccountTenantData } from "@/lib/tenantDataContext";

// POST /api/rooms/join/[token] — public. Name + password + language in, guest
// cookie out. Every failure (unknown link, expired, wrong password) is the same
// 401 so the response never reveals whether a room exists.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const joinSchema = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(64),
  language: z.enum(ROOM_LANGUAGES),
}).strict();

function invalid(): Response {
  return publicErrorResponse("authentication_required", 401);
}

// GET /api/rooms/join/[token] — probe before showing the form. An unknown or
// expired invite is a plain 404 (tokens are 32 random bytes, so this reveals
// nothing about other rooms). A valid invite answers `form`, or `session` with
// the caller's current seat when a live guest cookie already matches the room.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const token = (await params).token;
  if (typeof token !== "string" || token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(token)) {
    return publicErrorResponse("resource_not_found", 404);
  }
  const invite = await resolveRoomInvite(token);
  if (!invite) return publicErrorResponse("resource_not_found", 404);
  const guest = await resolveGuestSession(cookieValue(request, GUEST_SESSION_COOKIE));
  if (guest && guest.meetingId === invite.meetingId) {
    return jsonNoStore({ state: "session", id: invite.meetingId, name: guest.name, language: guest.language });
  }
  return jsonNoStore({ state: "form" });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 2 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) return publicErrorResponse("invalid_request", 400);

  const token = (await params).token;
  if (typeof token !== "string" || token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(token)) return invalid();
  const attemptKey = createHash("sha256").update(token).digest("base64url");
  if (!consumeRoomJoinAttempt(attemptKey)) return publicErrorResponse("too_many_attempts", 429);

  const invite = await resolveRoomInvite(token);
  if (!invite) return invalid();

  const now = new Date().toISOString();
  return runWithAccountTenantData(invite.hostAccountId, async () => {
    const fenced = await meetingFenceResponse(invite.meetingId);
    if (fenced) return invalid();
    let room;
    try {
      room = await readRoom(invite.meetingId);
    } catch {
      return invalid();
    }
    if (!room || !isGuestAccessOpen(room, now)) return invalid();
    if (!(await verifyRoomPassword(invite.meetingId, parsed.data.password))) return invalid();

    const seated = await joinRoomGuest(invite.meetingId, { name: parsed.data.name, language: parsed.data.language, now });
    let session: { token: string; expiresAt: string };
    try {
      session = await issueGuestSession({
        inviteToken: token,
        name: parsed.data.name,
        language: parsed.data.language,
        expiresAt: guestSessionExpiry(seated),
        now,
      });
    } catch (error) {
      if (error instanceof GuestSessionError) return invalid();
      throw error;
    }
    const identity = { role: "guest" as const, accountId: invite.hostAccountId, meetingId: invite.meetingId };
    const view = await publicRoom(request, seated, identity);
    return jsonWithGuestCookie(request, {
      id: invite.meetingId,
      room: { ...view, me: { role: "guest", name: parsed.data.name, language: parsed.data.language } },
    }, session);
  });
}
