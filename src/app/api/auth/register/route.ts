import { accountError, accountJson, emailField, readAccountJson, textField } from "@/lib/accountApi";
import { AccountStoreError, createCustomerApplication } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const body = parsed.body as Record<string, unknown> | null;
  const companyName = textField(body?.companyName, 100);
  const contactName = textField(body?.contactName, 60);
  const email = emailField(body?.email);
  const password = textField(body?.password, 200);
  const plan = body?.plan === "jpy" || body?.plan === "usd" ? body.plan : null;
  if (!companyName || !contactName || !email || !password || !plan) return accountError("invalid_request", 400);
  try {
    const account = await createCustomerApplication({ companyName, contactName, email, password, plan });
    return accountJson({ ok: true, applicationId: account.id, status: account.access }, 201);
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, error.code === "email_already_exists" ? 409 : 400);
    return accountError("internal_error", 500);
  }
}
