import {
  guardLoopbackApiRequest,
  parseBoundedJsonBody,
  requestBodyErrorResponse,
} from "@/lib/localRequestGuard";
import { accountError, accountJson, emailField, textField } from "@/lib/accountApi";
import { AccountStoreError, bootstrapSuperAdmin, readAccountStore } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = guardLoopbackApiRequest(request);
  if (denied) return denied;
  const store = await readAccountStore();
  return accountJson({ canBootstrap: !store.accounts.some((account) => account.role !== "customer") });
}

export async function POST(request: Request) {
  const denied = guardLoopbackApiRequest(request);
  if (denied) return denied;
  let body: Record<string, unknown> | null;
  try {
    body = await parseBoundedJsonBody(request, 16_384) as Record<string, unknown> | null;
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const name = textField(body?.name, 60);
  const email = emailField(body?.email);
  const password = textField(body?.password, 200);
  if (!name || !email || !password) return accountError("invalid_request", 400);
  try {
    const created = await bootstrapSuperAdmin({ name, email, password });
    return accountJson({
      ok: true,
      email: created.account.email,
      totpSecret: created.totpSecret,
      totpUri: created.totpUri,
      recoveryCodes: created.recoveryCodes,
    }, 201);
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, error.code === "admin_already_exists" ? 409 : 400);
    return accountError("internal_error", 500);
  }
}
