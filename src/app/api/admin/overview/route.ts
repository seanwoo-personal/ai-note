import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { accountError, accountJson } from "@/lib/accountApi";
import { resolveRequestSession } from "@/lib/accountSession";
import { adminOverview, publicAccount } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const session = await resolveRequestSession(request, "admin");
  if (!session) return accountError("access_denied", 401);
  return accountJson({ currentOperator: publicAccount(session.account), ...(await adminOverview()) });
}
