import { resolveRequestSession } from "@/lib/accountSession";
import { recordUsage, type UsageKind } from "@/lib/accountStore";

export async function recordRequestUsage(request: Request, kind: UsageKind, units = 1): Promise<void> {
  if (process.env.AI_NOTE_DISABLE_WORKER === "1") return;
  try {
    const session = await resolveRequestSession(request, "customer");
    if (session) await recordUsage(session.account.id, kind, units);
  } catch {
    // Usage telemetry must never turn a completed product action into a failure.
  }
}
