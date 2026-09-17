import { NextResponse } from "next/server";

import {
  computeAutoEndAt,
  isGuestAccessOpen,
  ROOM_GUEST_ACCESS_MS,
  type RoomDocument,
  type RoomLanguage,
  type RoomRole,
} from "@/domain/room";
import { GUEST_SESSION_COOKIE } from "@/lib/guestSession";
import { meetingFenceResponse } from "@/lib/meetingFence";
import { assertSafeId } from "@/lib/meetingId";
import { jsonNoStore, publicErrorResponse } from "@/lib/publicApi";
import {
  resolveGuestDetails,
  resolveRoomRequestIdentity,
  roomAccessDenied,
  type RoomRequestIdentity,
} from "@/lib/roomRequest";
import { readRoom, RoomStoreError } from "@/lib/roomStore";

// Shared pieces of the /api/rooms/* handlers: identity + fence + room read in
// the fixed order, the public DTO (no hashes, no paths), invite URL building,
// the guest cookie, and the error mapping.

export interface PublicRoomParticipant {
  role: RoomRole;
  name: string;
  language: RoomLanguage;
  /** Same-room mode: a diarization label has been bound to this seat. */
  registered: boolean;
}

export interface PublicRoom {
  id: string;
  mode: RoomDocument["mode"];
  title: string | null;
  createdAt: string;
  endedAt: string | null;
  guestExpiresAt: string | null;
  autoEndAt: string;
  participants: PublicRoomParticipant[];
  me: PublicRoomParticipant;
}

export type RoomRequestContext =
  | { ok: true; id: string; identity: RoomRequestIdentity; room: RoomDocument }
  | { ok: false; response: Response };

export async function resolveRoomRequest(
  request: Request,
  rawId: unknown,
  options: { requireHost?: boolean; now?: string } = {},
): Promise<RoomRequestContext> {
  let id: string;
  try {
    id = assertSafeId(rawId);
  } catch {
    return { ok: false, response: publicErrorResponse("invalid_request", 400, { field: "meetingId" }) };
  }
  const identity = resolveRoomRequestIdentity(request);
  const denied = roomAccessDenied(identity, id);
  if (denied || !identity) return { ok: false, response: denied ?? publicErrorResponse("authentication_required", 401) };
  if (options.requireHost && identity.role !== "host") {
    return { ok: false, response: publicErrorResponse("resource_not_found", 404) };
  }
  const fenced = await meetingFenceResponse(id);
  if (fenced) return { ok: false, response: fenced };
  let room: RoomDocument | null;
  try {
    room = await readRoom(id);
  } catch {
    return { ok: false, response: publicErrorResponse("content_state_ambiguous", 409, { meetingId: id }) };
  }
  if (!room) return { ok: false, response: publicErrorResponse("resource_not_found", 404) };
  if (identity.role === "guest" && !isGuestAccessOpen(room, options.now ?? new Date().toISOString())) {
    return { ok: false, response: publicErrorResponse("resource_not_found", 404) };
  }
  return { ok: true, id, identity, room };
}

export async function publicRoom(request: Request, room: RoomDocument, identity: RoomRequestIdentity): Promise<PublicRoom> {
  const participants = room.participants.map((item) => ({
    role: item.role, name: item.name, language: item.language, registered: item.speakerLabel !== null,
  }));
  let me = participants.find((item) => item.role === identity.role) ?? participants[0];
  if (identity.role === "guest") {
    const details = await resolveGuestDetails(request);
    if (details) me = { role: "guest", name: details.name, language: details.language as RoomLanguage, registered: me.registered };
  }
  return {
    id: room.id,
    mode: room.mode,
    title: room.title,
    createdAt: room.createdAt,
    endedAt: room.endedAt,
    guestExpiresAt: room.guestExpiresAt,
    autoEndAt: computeAutoEndAt(room.createdAt),
    participants,
    me,
  };
}

/** Public origin for links: pinned APP_ORIGIN behind the tunnel, else the request's own origin. */
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/u, "");
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = process.env.AI_NOTE_DEPLOYMENT_MODE === "cloud" && forwardedProto === "https" ? "https:" : url.protocol;
  return `${proto}//${url.host}`;
}

export function inviteUrl(request: Request, token: string): string {
  return `${publicOrigin(request)}/join/${token}`;
}

export const INVITE_EXPIRES_POLICY = "24h_after_end" as const;

/** Guest session lifetime: until the download window closes, or the running room's auto-end + window. */
export function guestSessionExpiry(room: RoomDocument): string {
  if (room.guestExpiresAt) return room.guestExpiresAt;
  return new Date(Date.parse(computeAutoEndAt(room.createdAt)) + ROOM_GUEST_ACCESS_MS).toISOString();
}

function secureForRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return process.env.AI_NOTE_DEPLOYMENT_MODE === "cloud" && request.headers.get("x-forwarded-proto") === "https";
}

export function jsonWithGuestCookie(
  request: Request,
  payload: unknown,
  cookie: { token: string; expiresAt: string },
): Response {
  const response = NextResponse.json(payload, { status: 200 });
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  response.cookies.set({
    name: GUEST_SESSION_COOKIE,
    value: cookie.token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureForRequest(request),
    path: "/",
    expires: new Date(cookie.expiresAt),
  });
  return response;
}

export function roomErrorResponse(error: unknown, id: string): Response {
  if (error instanceof RoomStoreError) {
    switch (error.code) {
      case "room_not_found":
        return publicErrorResponse("resource_not_found", 404);
      case "room_ended":
        return publicErrorResponse("meeting_conflict", 409, { meetingId: id });
      case "invalid_input":
        return publicErrorResponse("invalid_request", 400);
      case "room_corrupt":
      case "events_corrupt":
        return publicErrorResponse("content_state_ambiguous", 409, { meetingId: id });
    }
  }
  return publicErrorResponse("internal_error", 500);
}

export function noStoreJson(payload: unknown, status = 200): Response {
  return jsonNoStore(payload, status);
}
