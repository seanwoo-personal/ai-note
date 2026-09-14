export type AccountRouteKind = "asset" | "public" | "customer" | "admin";

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

export function classifyAccountRoute(pathname: string): AccountRouteKind {
  if (
    pathname.startsWith("/_next/")
    || pathname.startsWith("/fonts/")
    || pathname.startsWith("/brand/")
    || pathname === "/favicon.ico"
    || /\.[A-Za-z0-9]{2,8}$/u.test(pathname)
  ) return "asset";
  if (PUBLIC_EXACT.has(pathname)) return "public";
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/")) {
    return "admin";
  }
  return "customer";
}
