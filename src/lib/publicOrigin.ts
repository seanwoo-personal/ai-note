// Absolute origin for links handed to people outside the current tab (guest
// invites, operator setup links). Behind the tunnel the app sees plain http on
// an internal host, so a pinned APP_ORIGIN always wins; the request's own
// origin is only the local-development fallback.
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/u, "");
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = process.env.AI_NOTE_DEPLOYMENT_MODE === "cloud" && forwardedProto === "https" ? "https:" : url.protocol;
  return `${proto}//${url.host}`;
}
