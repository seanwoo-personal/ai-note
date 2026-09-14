import { POST as mintTemporaryKey } from "@/app/api/realtime/temporary-key/route";
import { guardLocalApiRequest } from "@/lib/localRequestGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = guardLocalApiRequest(request);
  if (denied) return denied;
  if (process.env.NODE_ENV === "production") {
    return new Response(null, {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return mintTemporaryKey(request);
}
