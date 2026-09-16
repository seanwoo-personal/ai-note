import { cookieValue } from "@/lib/accountSession";
import { GUEST_SESSION_COOKIE, resolveGuestSession } from "@/lib/guestSession";
import { publicErrorResponse } from "@/lib/publicApi";

// Who is calling a room API. Middleware rewrites every x-vision-* header from
// the verified session (customer or guest), so a guest identity here is only
// ever the one middleware pinned to the room session. Guests are scoped to a
// single meeting id; any other room answers as if it did not exist.

export type RoomRequestIdentity =
  | { role: "host"; accountId: string }
  | { role: "guest"; accountId: string; meetingId: string };

export function resolveRoomRequestIdentity(request: Request): RoomRequestIdentity | null {
  const accountId = request.headers.get("x-vision-account-id");
  if (!accountId) return null;
  const role = request.headers.get("x-vision-account-role");
  if (role === "guest") {
    const meetingId = request.headers.get("x-vision-guest-room");
    if (!meetingId) return null;
    return { role: "guest", accountId, meetingId };
  }
  return { role: "host", accountId };
}

/** 404 for a guest reaching outside its own room; 401 without any identity. */
export function roomAccessDenied(identity: RoomRequestIdentity | null, meetingId: string): Response | null {
  if (!identity) return publicErrorResponse("authentication_required", 401);
  if (identity.role === "guest" && identity.meetingId !== meetingId) {
    return publicErrorResponse("resource_not_found", 404);
  }
  return null;
}

/** Guest display details are read from the session store, never from headers. */
export async function resolveGuestDetails(request: Request): Promise<{ name: string; language: string } | null> {
  const guest = await resolveGuestSession(cookieValue(request, GUEST_SESSION_COOKIE));
  return guest ? { name: guest.name, language: guest.language } : null;
}
