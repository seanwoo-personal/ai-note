import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { accountError, accountJson } from "@/lib/accountApi";
import { resolveRequestSession } from "@/lib/accountSession";
import { AccountStoreError, revokeOperator } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super admin only: revoke a plain operator seat. The super admin itself is never a valid target. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const session = await resolveRequestSession(request, "admin");
  if (!session || session.account.role !== "super_admin") return accountError("access_denied", 403);
  const { id } = await context.params;
  if (id === session.account.id) return accountError("invalid_request", 400);
  try {
    await revokeOperator(id, session.account.id);
    return accountJson({ ok: true });
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, 404);
    return accountError("internal_error", 500);
  }
}
