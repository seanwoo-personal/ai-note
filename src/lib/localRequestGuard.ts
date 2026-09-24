import {
  publicErrorResponse,
  type PublicErrorCode,
} from "@/lib/publicApi";
import { isStreamingFinalizePath } from "@/lib/accountAccessPolicy";
import { activateAccountTenantData } from "@/lib/tenantDataContext";

export const DATA_SURFACE_INVENTORY = [
  "/api/admin/bootstrap",
  "/api/admin/customers/[id]",
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/mfa-reset",
  "/api/admin/operators/[id]",
  "/api/admin/operators/accept",
  "/api/admin/operators/invite",
  "/api/admin/overview",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/password/change",
  "/api/auth/password/forgot",
  "/api/auth/register",
  "/api/auth/session",
  "/api/chat",
  "/api/glossary",
  "/api/folders",
  "/api/folders/[id]",
  "/api/folders/[id]/delete-preview",
  "/api/folders/[id]/parent",
  "/api/knowledge/reindex",
  "/api/library",
  "/api/library/rebuild",
  "/api/library/reveal",
  "/api/meetings",
  "/api/meetings/[id]",
  "/api/meetings/[id]/audio",
  "/api/meetings/[id]/content",
  "/api/meetings/[id]/export",
  "/api/meetings/[id]/finalize",
  "/api/meetings/[id]/location",
  "/api/meetings/[id]/reveal",
  "/api/meetings/[id]/review",
  "/api/meetings/[id]/session",
  "/api/meetings/[id]/summarize",
  "/api/meetings/[id]/summary",
  "/api/meetings/[id]/title",
  "/api/meetings/[id]/transcript",
  "/api/meetings/[id]/transcript/regenerate",
  "/api/organization-pending",
  "/api/realtime/temporary-key",
  "/api/rooms",
  "/api/rooms/join/[token]",
  "/api/rooms/[id]",
  "/api/rooms/[id]/end",
  "/api/rooms/[id]/events",
  "/api/rooms/[id]/export",
  "/api/rooms/[id]/invite/rotate",
  "/api/rooms/[id]/participants/[role]/speaker-label",
  "/api/rooms/[id]/utterances",
  "/api/rooms/[id]/utterances/[utteranceId]/speaker",
  "/api/realtime/android-temporary-key",
  "/api/settings/llm",
  "/api/settings/llm/health",
  "/api/settings/llm/models",
  "/api/settings/profile",
  "/api/search",
  "/api/summary-work",
  "/api/summarize",
  "/api/transcribe",
  "/api/translate",
  "/api/workspaces",
  "/api/workspaces/[id]",
  "/api/workspaces/[id]/delete-preview",
  "/meetings/[id]",
] as const;

export type LocalRequestKind = "api" | "page";

export type LocalRequestValidation =
  | { ok: true }
  | { ok: false; code: PublicErrorCode; status: number };

interface ParsedHost {
  hostname: "127.0.0.1" | "localhost";
  port: string;
}

function parseCloudHost(rawHost: string | null): string | null {
  if (!rawHost || /[,\s@/\\?#]/u.test(rawHost)) return null;
  const match = /^([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/u.exec(rawHost);
  if (!match) return null;
  const hostname = match[1].toLowerCase();
  if (hostname.length > 253 || hostname.split(".").some((label) =>
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(label))) return null;
  const port = match[2] ?? "";
  if (port) {
    if (port.length > 1 && port.startsWith("0")) return null;
    const numeric = Number(port);
    if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 65_535) return null;
  }
  return `${hostname}${port ? `:${port}` : ""}`;
}

function configuredCloudOrigin(): string | null | "invalid" {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
      || configured !== parsed.origin
    ) return "invalid";
    return parsed.origin;
  } catch {
    return "invalid";
  }
}

function parseRawHost(rawHost: string | null): ParsedHost | null {
  if (!rawHost || /[,\s@]/u.test(rawHost)) return null;
  const match = /^(127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?$/u.exec(rawHost);
  if (!match) return null;
  const port = match[2] ?? "";
  if (port) {
    if (port.length > 1 && port.startsWith("0")) return null;
    const numeric = Number(port);
    if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 65_535) return null;
  }
  return { hostname: match[1] as ParsedHost["hostname"], port };
}

function reject(code: PublicErrorCode, status = 403): LocalRequestValidation {
  return { ok: false, code, status };
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export function validateLocalRequest(
  request: Request,
  kind: LocalRequestKind,
): LocalRequestValidation {
  const url = new URL(request.url);
  const directRawHost = request.headers.get("host") ?? url.host;
  const directLocalHost = parseRawHost(directRawHost);
  let expectedOrigin: string;
  if (directLocalHost) {
    const directUrlMatches = url.protocol === "http:"
      && url.hostname === directLocalHost.hostname
      && url.port === directLocalHost.port;
    const cloudLoopbackForward = process.env.AI_NOTE_DEPLOYMENT_MODE === "cloud"
      && url.protocol === "http:"
      && (request.headers.get("x-forwarded-proto") ?? "http") === "http";
    if (
      (!directUrlMatches && !cloudLoopbackForward)
      || url.username !== ""
      || url.password !== ""
    ) return reject("invalid_host");
    expectedOrigin = `http://${directRawHost}`;
  } else {
    // Only consult deployment configuration after an ordinary loopback request
    // has been ruled out. Rejected ingress therefore cannot trigger secret reads.
    const cloud = process.env.AI_NOTE_DEPLOYMENT_MODE === "cloud";
    if (!cloud) return reject("invalid_host");
    const rawHost = request.headers.get("x-forwarded-host")
      ?? request.headers.get("host")
      ?? url.host;
    const host = parseCloudHost(rawHost);
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
    const pinnedOrigin = configuredCloudOrigin();
    if (
      !host
      || forwardedProto !== "https"
      || url.username !== ""
      || url.password !== ""
      || pinnedOrigin === "invalid"
    ) return reject("invalid_host");
    expectedOrigin = `https://${host}`;
    if (pinnedOrigin && expectedOrigin !== pinnedOrigin) return reject("invalid_host");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    const accepted = kind === "page"
      ? fetchSite === "same-origin" || fetchSite === "none"
      : fetchSite === "same-origin";
    if (!accepted) return reject("cross_site_request");
  }

  if (!isSafeMethod(request.method.toUpperCase())) {
    const rawOrigin = request.headers.get("origin");
    if (rawOrigin === null) return reject("missing_origin");
    if (rawOrigin === "null" || rawOrigin.includes(",")) return reject("invalid_origin");
    try {
      const origin = new URL(rawOrigin);
      if (
        rawOrigin !== origin.origin
        || origin.origin !== expectedOrigin
        || origin.username !== ""
        || origin.password !== ""
      ) {
        return reject("invalid_origin");
      }
    } catch {
      return reject("invalid_origin");
    }
  }

  return { ok: true };
}

export function guardLocalApiRequest(request: Request): Response | null {
  const result = validateLocalRequest(request, "api");
  if (!result.ok) return publicErrorResponse(result.code, result.status);
  // Middleware overwrites this header from the session for every data route
  // except the streaming finalize upload, where a client-supplied value would
  // reach the route unchanged. That route derives identity from the session.
  if (isStreamingFinalizePath(new URL(request.url).pathname)) return null;
  const accountId = request.headers.get("x-vision-account-id");
  if (accountId) {
    try {
      activateAccountTenantData(accountId);
    } catch {
      return publicErrorResponse("authentication_required", 401);
    }
  }
  return null;
}

/**
 * Restricts one-time administrative setup endpoints to an explicit loopback
 * origin, even when the rest of the application is running in cloud mode.
 * This keeps a public deployment from exposing an unclaimed super-admin slot.
 */
export function guardLoopbackApiRequest(request: Request): Response | null {
  const rawHost = request.headers.get("host");
  if (!parseRawHost(rawHost)) return publicErrorResponse("invalid_host", 403);

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return publicErrorResponse("cross_site_request", 403);
  }

  if (!isSafeMethod(request.method.toUpperCase())) {
    const rawOrigin = request.headers.get("origin");
    if (rawOrigin === null) return publicErrorResponse("missing_origin", 403);
    try {
      const origin = new URL(rawOrigin);
      if (
        rawOrigin !== origin.origin
        || origin.origin !== `http://${rawHost}`
        || origin.username !== ""
        || origin.password !== ""
      ) return publicErrorResponse("invalid_origin", 403);
    } catch {
      return publicErrorResponse("invalid_origin", 403);
    }
  }

  return null;
}

export function validateLocalPageHeaders(headers: Headers): LocalRequestValidation {
  const host = headers.get("host");
  if (!host) return reject("invalid_host");
  return validateLocalRequest(new Request(`http://${host}/`, { headers }), "page");
}

export type RequestBodyErrorCode =
  | "unsupported_media_type"
  | "request_body_too_large"
  | "invalid_content_length"
  | "invalid_json";

export class RequestBodyError extends Error {
  readonly code: RequestBodyErrorCode;
  readonly status: number;

  constructor(code: RequestBodyErrorCode, status: number) {
    super(code);
    this.name = "RequestBodyError";
    this.code = code;
    this.status = status;
  }
}

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/iu;

export async function parseBoundedJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new RequestBodyError("unsupported_media_type", 415);
  }

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declared)) {
      throw new RequestBodyError("invalid_content_length", 400);
    }
    if (Number(declared) > maxBytes) {
      throw new RequestBodyError("request_body_too_large", 413);
    }
  }

  if (!request.body) throw new RequestBodyError("invalid_json", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new RequestBodyError("request_body_too_large", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError("invalid_json", 400);
  }
}

export function requestBodyErrorResponse(error: unknown): Response {
  if (error instanceof RequestBodyError) {
    return publicErrorResponse(error.code, error.status);
  }
  return publicErrorResponse("invalid_json", 400);
}
