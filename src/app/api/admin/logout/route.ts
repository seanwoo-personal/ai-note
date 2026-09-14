import { accountJson, readAccountJson } from "@/lib/accountApi";
import { ADMIN_SESSION_COOKIE, clearSessionCookie, cookieValue } from "@/lib/accountSession";
import { revokeSession } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  await revokeSession(cookieValue(request, ADMIN_SESSION_COOKIE));
  const response = accountJson({ ok: true });
  clearSessionCookie(response, "admin", request);
  return response;
}
