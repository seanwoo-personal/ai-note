import { accountError, accountJson, emailField, readAccountJson, textField } from "@/lib/accountApi";
import { consumeAccountRateLimit } from "@/lib/accountRateLimit";
import { setSessionCookie } from "@/lib/accountSession";
import { AccountStoreError, authenticateCustomer, issueSession, publicAccount } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const body = parsed.body as Record<string, unknown> | null;
  const email = emailField(body?.email);
  const password = textField(body?.password, 200);
  if (!email || !password) return accountError("invalid_credentials", 401);
  if (!consumeAccountRateLimit(`customer:${email}`)) return accountError("too_many_attempts", 429);
  try {
    const account = await authenticateCustomer(email, password);
    const session = await issueSession(account.id, "customer", 12 * 60 * 60);
    const response = accountJson({ ok: true, account: publicAccount(account), expiresAt: session.expiresAt });
    setSessionCookie(response, "customer", session.token, session.expiresAt, request);
    return response;
  } catch (error) {
    if (error instanceof AccountStoreError) {
      const status = error.code === "invalid_credentials" ? 401 : 403;
      return accountError(error.code, status);
    }
    return accountError("internal_error", 500);
  }
}
