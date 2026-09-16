import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { classifyAccountRoute, isStreamingFinalizePath } from "@/lib/accountAccessPolicy";
import { cookieValue, resolveRequestSession } from "@/lib/accountSession";
import { GUEST_SESSION_COOKIE, resolveGuestSession } from "@/lib/guestSession";

export const runtime = "nodejs";

function loginRedirect(request: NextRequest, target: "/login" | "/admin/login") {
  const url = request.nextUrl.clone();
  const requested = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = target;
  url.search = "";
  if (!requested.startsWith("//")) url.searchParams.set("next", requested);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const kind = classifyAccountRoute(request.nextUrl.pathname);
  if (kind === "asset" || kind === "public") return NextResponse.next();

  const sessionKind = kind === "admin" ? "admin" : "customer";
  const session = await resolveRequestSession(request, sessionKind);
  if (!session && kind === "room") {
    // A guest carries no account. Its room session pins the host tenant and the
    // single meeting it may touch; every x-vision-* header is rewritten so a
    // client cannot smuggle its own values.
    const guest = await resolveGuestSession(cookieValue(request, GUEST_SESSION_COOKIE));
    if (guest) {
      const headers = new Headers(request.headers);
      headers.set("x-vision-account-id", guest.hostAccountId);
      headers.set("x-vision-account-role", "guest");
      headers.set("x-vision-guest-room", guest.meetingId);
      return NextResponse.next({ request: { headers } });
    }
  }
  if (session) {
    if (sessionKind === "customer" && session.account.passwordChangeRequired) {
      const allowedDuringPasswordChange = request.nextUrl.pathname === "/password/change"
        || request.nextUrl.pathname === "/api/auth/password/change"
        || request.nextUrl.pathname === "/api/auth/logout"
        || request.nextUrl.pathname === "/api/auth/session";
      if (!allowedDuringPasswordChange) {
        if (request.nextUrl.pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: { code: "password_change_required", message: "새 비밀번호를 설정해야 계속 사용할 수 있습니다." } },
            { status: 403, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
          );
        }
        const url = request.nextUrl.clone();
        url.pathname = "/password/change";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
    // Passing an overridden request through Next middleware clones the request.
    // A raw audio upload is consumed as a stream in the route and must retain
    // sole ownership of its body; the route resolves the authenticated session
    // again to establish its tenant data context and ignores identity headers.
    if (isStreamingFinalizePath(request.nextUrl.pathname)) {
      return NextResponse.next();
    }
    const headers = new Headers(request.headers);
    headers.set("x-vision-account-id", session.account.id);
    headers.set("x-vision-account-role", session.account.role);
    headers.delete("x-vision-guest-room");
    return NextResponse.next({ request: { headers } });
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "authentication_required", message: "로그인이 필요합니다." } },
      { status: 401, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  }
  return loginRedirect(request, kind === "admin" ? "/admin/login" : "/login");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
