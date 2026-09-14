import { accountError, accountJson, readAccountJson, textField } from "@/lib/accountApi";
import { resolveRequestSession, setSessionCookie } from "@/lib/accountSession";
import { AccountStoreError, changeCustomerPassword, issueSession } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const body = parsed.body as Record<string, unknown> | null;
  const password = textField(body?.password, 200);
  const confirmation = textField(body?.confirmation, 200);
  if (!password || password !== confirmation) return accountError("password_confirmation_mismatch", 400);

  const session = await resolveRequestSession(request, "customer");
  if (!session) return accountError("authentication_required", 401);
  if (!session.account.passwordChangeRequired) return accountError("access_denied", 403);

  try {
    await changeCustomerPassword(session.account.id, password);
    const nextSession = await issueSession(session.account.id, "customer", 12 * 60 * 60);
    const response = accountJson({ ok: true });
    setSessionCookie(response, "customer", nextSession.token, nextSession.expiresAt, request);
    return response;
  } catch (error) {
    if (error instanceof AccountStoreError) {
      return accountError(error.code, error.code === "password_policy" ? 400 : 403);
    }
    return accountError("internal_error", 500);
  }
}
