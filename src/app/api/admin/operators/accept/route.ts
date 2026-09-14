import { accountError, accountJson, readAccountJson, textField } from "@/lib/accountApi";
import { AccountStoreError, acceptOperatorInvitation } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const body = parsed.body as Record<string, unknown> | null;
  const token = textField(body?.token, 200);
  const password = textField(body?.password, 200);
  if (!token || !password) return accountError("invitation_invalid", 400);
  try {
    const accepted = await acceptOperatorInvitation({ token, password });
    return accountJson({
      ok: true,
      email: accepted.account.email,
      totpSecret: accepted.totpSecret,
      totpUri: accepted.totpUri,
      recoveryCodes: accepted.recoveryCodes,
    }, 201);
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, 400);
    return accountError("internal_error", 500);
  }
}
