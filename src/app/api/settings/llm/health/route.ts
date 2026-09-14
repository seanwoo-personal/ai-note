import { guardLocalApiRequest } from "@/lib/localRequestGuard";
import { jsonNoStore } from "@/lib/publicApi";
import { readSettings } from "@/lib/settings";
import { getAdapter } from "@/services/llm";

// GET /api/settings/llm/health — checks only the persisted configuration. CLI
// providers detect the binary; Ollama verifies loopback reachability + exact model.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  const s = await readSettings();
  if (!s) return jsonNoStore({ configured: false });
  const model = s.model?.trim();

  if (s.provider === "ollama" && !model) {
    return jsonNoStore({ configured: true, ok: false });
  }

  try {
    const adapter = getAdapter(s);
    const health = await adapter.health();
    return jsonNoStore({ configured: true, ok: health.ok });
  } catch {
    return jsonNoStore({ configured: true, ok: false });
  }
}
