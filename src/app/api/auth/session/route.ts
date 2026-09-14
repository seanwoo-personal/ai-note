import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { accountJson } from "@/lib/accountApi";
import { resolveRequestSession } from "@/lib/accountSession";
import { publicAccount } from "@/lib/accountStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const customer = await resolveRequestSession(request, "customer");
  if (customer) return accountJson({ authenticated: true, kind: "customer", account: publicAccount(customer.account), expiresAt: customer.expiresAt });
  const admin = await resolveRequestSession(request, "admin");
  if (admin) return accountJson({ authenticated: true, kind: "admin", account: publicAccount(admin.account), expiresAt: admin.expiresAt });
  return accountJson({ authenticated: false }, 401);
}
