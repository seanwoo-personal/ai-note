import { accountError, accountJson, emailField, readAccountJson, textField } from "@/lib/accountApi";
import { consumeAccountRateLimit } from "@/lib/accountRateLimit";
import { setSessionCookie } from "@/lib/accountSession";
import { AccountStoreError, authenticateAdmin, issueSession, publicAccount } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const body = parsed.body as Record<string, unknown> | null;
  const email = emailField(body?.email);
  const password = textField(body?.password, 200);
  const otp = textField(body?.otp, 64);
  if (!email || !password || !otp) return accountError("invalid_credentials", 401);
  if (!consumeAccountRateLimit(`admin:${email}`, 6)) return accountError("too_many_attempts", 429);
  try {
    const account = await authenticateAdmin({ email, password, otp });
    const session = await issueSession(account.id, "admin", 4 * 60 * 60);
    const response = accountJson({ ok: true, account: publicAccount(account), expiresAt: session.expiresAt });
    setSessionCookie(response, "admin", session.token, session.expiresAt, request);
    return response;
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, 401);
    return accountError("internal_error", 500);
  }
}
