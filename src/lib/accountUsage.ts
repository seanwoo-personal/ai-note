import { cookieValue, resolveRequestSession } from "@/lib/accountSession";
import { recordUsage, type UsageKind } from "@/lib/accountStore";
import { GUEST_SESSION_COOKIE, resolveGuestSession } from "@/lib/guestSession";

// Usage is always charged to an account. A customer session charges itself; a
// guest (shared interpreter room, ADR 0028) charges the host that invited it.
export async function recordRequestUsage(request: Request, kind: UsageKind, units = 1): Promise<void> {
  if (process.env.AI_NOTE_DISABLE_WORKER === "1") return;
  try {
    const session = await resolveRequestSession(request, "customer");
    if (session) {
      await recordUsage(session.account.id, kind, units);
      return;
    }
    const guest = await resolveGuestSession(cookieValue(request, GUEST_SESSION_COOKIE));
    if (guest) await recordUsage(guest.hostAccountId, kind, units);
  } catch {
    // Usage telemetry must never turn a completed product action into a failure.
  }
}
