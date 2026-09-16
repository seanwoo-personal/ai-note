// "room": a shared interpreter-room surface that accepts either a customer
// session (host) or a guest session bound to that room (ADR 0028).
export type AccountRouteKind = "asset" | "public" | "customer" | "admin" | "room";

const PUBLIC_PREFIXES = ["/join/", "/api/rooms/join/"];

// Shared APIs a guest may call with its room session; usage is charged to the host.
const ROOM_SHARED_API = new Set(["/api/realtime/temporary-key", "/api/translate"]);

const PUBLIC_EXACT = new Set([
  "/login",
  "/signup",
  "/signup/success",
  "/forgot-password",
  "/admin/login",
  "/admin/mfa-reset",
  "/admin/setup",
  "/admin/accept",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/password/forgot",
  "/api/auth/session",
  "/api/auth/logout",
  "/api/realtime/android-temporary-key",
  "/api/admin/login",
  "/api/admin/mfa-reset",
  "/api/admin/logout",
  "/api/admin/bootstrap",
  "/api/admin/operators/accept",
]);

// The raw audio upload is consumed as a stream inside the route, so middleware
// cannot rewrite its headers (an overridden request is cloned). The route
// re-resolves the session itself and every layer must ignore identity headers
// on this path.
const STREAMING_FINALIZE_PATH = /^\/api\/meetings\/[^/]+\/finalize$/u;

export function isStreamingFinalizePath(pathname: string): boolean {
  return STREAMING_FINALIZE_PATH.test(pathname);
}

export function classifyAccountRoute(pathname: string): AccountRouteKind {
  if (
    pathname.startsWith("/_next/")
    || pathname.startsWith("/fonts/")
    || pathname.startsWith("/brand/")
    || pathname === "/favicon.ico"
    || /\.[A-Za-z0-9]{2,8}$/u.test(pathname)
  ) return "asset";
  if (PUBLIC_EXACT.has(pathname)) return "public";
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "public";
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/")) {
    return "admin";
  }
  if (pathname.startsWith("/api/rooms/") || ROOM_SHARED_API.has(pathname)) return "room";
  return "customer";
}
