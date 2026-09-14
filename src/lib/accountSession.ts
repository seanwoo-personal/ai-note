import type { NextResponse } from "next/server";

import {
  accountDataRoot,
  resolveSession,
  type SessionKind,
} from "@/lib/accountStore";

export const CUSTOMER_SESSION_COOKIE = "vision_customer_session";
export const ADMIN_SESSION_COOKIE = "vision_admin_session";

function cookieName(kind: SessionKind): string {
  return kind === "customer" ? CUSTOMER_SESSION_COOKIE : ADMIN_SESSION_COOKIE;
}

function secureForRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return process.env.AI_NOTE_DEPLOYMENT_MODE === "cloud"
    && request.headers.get("x-forwarded-proto") === "https";
}

export function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

export async function resolveRequestSession(request: Request, kind: SessionKind) {
  return resolveSession(cookieValue(request, cookieName(kind)), kind, accountDataRoot());
}

export function setSessionCookie(
  response: NextResponse,
  kind: SessionKind,
  token: string,
  expiresAt: string,
  request: Request,
): void {
  response.cookies.set({
    name: cookieName(kind),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureForRequest(request),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse, kind: SessionKind, request: Request): void {
  response.cookies.set({
    name: cookieName(kind),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureForRequest(request),
    path: "/",
    expires: new Date(0),
  });
}
