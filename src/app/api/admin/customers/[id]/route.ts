import { accountError, accountJson, readAccountJson } from "@/lib/accountApi";
import { resolveRequestSession } from "@/lib/accountSession";
import {
  AccountStoreError,
  approveCustomer,
  setCustomerBilling,
  setCustomerBlocked,
  setCustomerPlan,
} from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const session = await resolveRequestSession(request, "admin");
  if (!session) return accountError("access_denied", 401);
  const { id } = await context.params;
  const action = (parsed.body as Record<string, unknown> | null)?.action;
  try {
    if (action === "approve") await approveCustomer(id, session.account.id);
    else if (action === "billing_paid") await setCustomerBilling(id, "paid", session.account.id);
    else if (action === "billing_unpaid") await setCustomerBilling(id, "unpaid", session.account.id);
    else if (action === "billing_overdue") await setCustomerBilling(id, "overdue", session.account.id);
    else if (action === "block") await setCustomerBlocked(id, true, session.account.id);
    else if (action === "unblock") await setCustomerBlocked(id, false, session.account.id);
    else if (action === "plan_jpy") await setCustomerPlan(id, "jpy", session.account.id);
    else if (action === "plan_usd") await setCustomerPlan(id, "usd", session.account.id);
    else return accountError("invalid_request", 400);
    return accountJson({ ok: true });
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, 404);
    return accountError("internal_error", 500);
  }
}
