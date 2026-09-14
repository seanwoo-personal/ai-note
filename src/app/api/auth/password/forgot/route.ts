import { accountError, accountJson, emailField, readAccountJson } from "@/lib/accountApi";
import { consumeAccountRateLimit } from "@/lib/accountRateLimit";
import {
  cancelCustomerTemporaryPassword,
  requestCustomerTemporaryPassword,
} from "@/lib/accountStore";
import {
  passwordRecoveryEmailConfigured,
  sendCustomerTemporaryPasswordEmail,
} from "@/services/passwordRecoveryEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED_MESSAGE = "가입된 이메일이라면 임시 비밀번호를 발송했습니다.";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const body = parsed.body as Record<string, unknown> | null;
  const email = emailField(body?.email);
  if (!email) return accountError("invalid_request", 400);
  if (!consumeAccountRateLimit(`password-reset:${email}`, 3, 60 * 60 * 1_000)) {
    return accountError("too_many_password_resets", 429);
  }
  if (!passwordRecoveryEmailConfigured()) return accountError("password_email_unavailable", 503);

  try {
    const reset = await requestCustomerTemporaryPassword(email);
    if (reset) {
      try {
        await sendCustomerTemporaryPasswordEmail({
          to: reset.email,
          name: reset.name,
          temporaryPassword: reset.temporaryPassword,
          expiresAt: reset.expiresAt,
        });
      } catch {
        await cancelCustomerTemporaryPassword(reset.accountId, reset.requestId).catch(() => undefined);
      }
    }
    return accountJson({ ok: true, message: ACCEPTED_MESSAGE }, 202);
  } catch {
    return accountError("internal_error", 500);
  }
}
