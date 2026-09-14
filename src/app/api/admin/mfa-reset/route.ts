import { accountError, accountJson, emailField, textField } from "@/lib/accountApi";
import { consumeAccountRateLimit } from "@/lib/accountRateLimit";
import { AccountStoreError, resetAdminMfa } from "@/lib/accountStore";
import {
  guardLoopbackApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = guardLoopbackApiRequest(request);
  if (denied) return denied;

  let body: Record<string, unknown> | null;
  try {
    body = await parseBoundedJsonBody(request, 16_384) as Record<string, unknown> | null;
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const email = emailField(body?.email);
  const password = textField(body?.password, 200);
  if (!email || !password) return accountError("invalid_credentials", 401);
  if (!consumeAccountRateLimit(`admin-mfa-reset:${email}`, 3)) return accountError("too_many_attempts", 429);

  try {
    const reset = await resetAdminMfa({ email, password });
    return accountJson({
      ok: true,
      email: reset.account.email,
      totpSecret: reset.totpSecret,
      totpUri: reset.totpUri,
      recoveryCodes: reset.recoveryCodes,
    });
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, 401);
    return accountError("internal_error", 500);
  }
}
