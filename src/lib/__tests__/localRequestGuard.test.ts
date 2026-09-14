// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DATA_SURFACE_INVENTORY,
  guardLocalApiRequest,
  guardLoopbackApiRequest,
  parseBoundedJsonBody,
  validateLocalRequest,
} from "@/lib/localRequestGuard";

const BASE = "http://127.0.0.1:3000";

function request(
  path = "/api/meetings",
  init: RequestInit = {},
): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: {
      host: "127.0.0.1:3000",
      ...(init.headers ?? {}),
    },
  });
}

describe("local request boundary", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.1:3000",
    "localhost",
    "localhost:65535",
  ])("accepts exact loopback Host %s", (host) => {
    const req = new Request(`http://${host}/api/meetings`, { headers: { host } });
    expect(validateLocalRequest(req, "api")).toEqual({ ok: true });
  });

  it.each([
    "localhost.evil",
    "localhost.",
    "user@localhost:3000",
    "127.0.0.1:0",
    "127.0.0.1:65536",
    "127.0.0.1:not-a-port",
    "localhost:03000",
    "localhost, 127.0.0.1",
    "[::1]:3000",
  ])("rejects ambiguous/non-contract Host %s", (host) => {
    const req = new Request(BASE, { headers: { host } });
    expect(validateLocalRequest(req, "api")).toMatchObject({ ok: false, code: "invalid_host" });
  });

  it("rejects a URL authority that disagrees with Host", () => {
    const req = new Request("http://localhost:3000/api/meetings", {
      headers: { host: "127.0.0.1:3000" },
    });
    expect(validateLocalRequest(req, "api")).toMatchObject({ ok: false, code: "invalid_host" });
  });

  it.each(["cross-site", "same-site", "none"])("rejects API Sec-Fetch-Site %s", (site) => {
    expect(validateLocalRequest(request("/api/meetings", {
      headers: { "sec-fetch-site": site },
    }), "api")).toMatchObject({ ok: false, code: "cross_site_request" });
  });

  it("allows same-origin API/RSC and direct document navigation only for pages", () => {
    expect(validateLocalRequest(request("/api/meetings", {
      headers: { "sec-fetch-site": "same-origin" },
    }), "api")).toEqual({ ok: true });
    expect(validateLocalRequest(request("/meetings/m1", {
      headers: { "sec-fetch-site": "none" },
    }), "page")).toEqual({ ok: true });
    expect(validateLocalRequest(request("/meetings/m1", {
      headers: { "sec-fetch-site": "same-origin", rsc: "1" },
    }), "page")).toEqual({ ok: true });
  });

  it.each([
    [null, "missing_origin"],
    ["null", "invalid_origin"],
    ["http://localhost:3000", "invalid_origin"],
    ["https://127.0.0.1:3000", "invalid_origin"],
    ["http://127.0.0.1:3001", "invalid_origin"],
  ] as const)("rejects unsafe request Origin %s", (origin, code) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin !== null) headers.origin = origin;
    const req = request("/api/settings/llm", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(validateLocalRequest(req, "api")).toMatchObject({ ok: false, code });
  });

  it("accepts an exact unsafe-method Origin", () => {
    const req = request("/api/settings/llm", {
      method: "POST",
      headers: {
        origin: BASE,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    expect(validateLocalRequest(req, "api")).toEqual({ ok: true });
  });

  it("returns a no-store static error envelope", async () => {
    const response = guardLocalApiRequest(new Request("http://evil.test/api/meetings", {
      headers: { host: "evil.test" },
    }));
    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.json()).toEqual({
      error: {
        code: "invalid_host",
        message: "로컬 앱 요청만 허용됩니다",
      },
    });
  });
});

describe("HTTPS cloud request boundary", () => {
  function cloudRequest(path: string, init: RequestInit = {}) {
    return new Request(`http://app:3000${path}`, {
      ...init,
      headers: {
        host: "temporary-test.trycloudflare.com",
        "x-forwarded-proto": "https",
        ...(init.headers ?? {}),
      },
    });
  }

  it("accepts a same-origin HTTPS request forwarded by the deployment proxy", () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    const req = cloudRequest("/api/settings/llm", {
      method: "POST",
      headers: {
        origin: "https://temporary-test.trycloudflare.com",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    expect(validateLocalRequest(req, "api")).toEqual({ ok: true });
    vi.unstubAllEnvs();
  });

  it("accepts an HTTP loopback origin forwarded inside the cloud container network", () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    const req = new Request("http://app:3000/api/admin/login", {
      method: "POST",
      headers: {
        host: "localhost:43101",
        origin: "http://localhost:43101",
        "x-forwarded-proto": "http",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    expect(validateLocalRequest(req, "api")).toEqual({ ok: true });
    vi.unstubAllEnvs();
  });

  it("does not treat HTTPS ingress with a loopback Host as a local tunnel", () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    const req = new Request("http://app:3000/api/admin/login", {
      method: "POST",
      headers: {
        host: "localhost:43101",
        origin: "http://localhost:43101",
        "x-forwarded-proto": "https",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    expect(validateLocalRequest(req, "api")).toMatchObject({ ok: false, code: "invalid_host" });
    vi.unstubAllEnvs();
  });

  it("rejects plain HTTP, ambiguous forwarded hosts, and cross-origin writes", () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    expect(validateLocalRequest(new Request("http://app:3000/api/meetings", {
      headers: { host: "temporary-test.trycloudflare.com", "x-forwarded-proto": "http" },
    }), "api")).toMatchObject({ ok: false, code: "invalid_host" });
    expect(validateLocalRequest(cloudRequest("/api/meetings", {
      headers: { "x-forwarded-host": "good.example, evil.example" },
    }), "api")).toMatchObject({ ok: false, code: "invalid_host" });
    expect(validateLocalRequest(cloudRequest("/api/settings/llm", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    }), "api")).toMatchObject({ ok: false, code: "invalid_origin" });
    vi.unstubAllEnvs();
  });

  it("pins the public origin when APP_ORIGIN is configured", () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    vi.stubEnv("APP_ORIGIN", "https://stable.example.com");
    expect(validateLocalRequest(cloudRequest("/api/meetings"), "api"))
      .toMatchObject({ ok: false, code: "invalid_host" });
    const pinned = new Request("http://app:3000/api/meetings", {
      headers: { host: "stable.example.com", "x-forwarded-proto": "https" },
    });
    expect(validateLocalRequest(pinned, "api")).toEqual({ ok: true });
    vi.unstubAllEnvs();
  });

  it("keeps one-time administrative bootstrap restricted to loopback", async () => {
    vi.stubEnv("AI_NOTE_DEPLOYMENT_MODE", "cloud");
    const cloud = cloudRequest("/api/admin/bootstrap");
    const denied = guardLoopbackApiRequest(cloud);
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toMatchObject({
      error: { code: "invalid_host" },
    });
    expect(guardLoopbackApiRequest(request("/api/admin/bootstrap"))).toBeNull();
    expect(guardLoopbackApiRequest(new Request("http://app:3000/api/admin/bootstrap", {
      headers: { host: "localhost:3101", "sec-fetch-site": "same-origin" },
    }))).toBeNull();
    expect(guardLoopbackApiRequest(new Request("http://app:3000/api/admin/bootstrap", {
      method: "POST",
      headers: {
        host: "localhost:3101",
        origin: "http://localhost:3101",
        "sec-fetch-site": "same-origin",
      },
    }))).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("bounded JSON stream", () => {
  function jsonRequest(body: BodyInit, headers: Record<string, string> = {}) {
    return request("/api/test", {
      method: "POST",
      headers: { origin: BASE, "content-type": "application/json; charset=utf-8", ...headers },
      body,
      duplex: "half",
    } as RequestInit);
  }

  it("parses JSON with optional UTF-8 charset", async () => {
    await expect(parseBoundedJsonBody(jsonRequest(JSON.stringify({ 이름: "딜런" })), 1024))
      .resolves.toEqual({ 이름: "딜런" });
  });

  it.each(["text/plain", "application/json-patch+json", "application/json; charset=euc-kr"])(
    "rejects content type %s",
    async (contentType) => {
      await expect(parseBoundedJsonBody(jsonRequest("{}", { "content-type": contentType }), 1024))
        .rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });
    },
  );

  it("rejects an oversized declared body before reading", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const req = jsonRequest(body, { "content-length": "9999" });
    const getReader = vi.spyOn(req.body as ReadableStream<Uint8Array>, "getReader");
    await expect(parseBoundedJsonBody(req, 16)).rejects.toMatchObject({
      code: "request_body_too_large",
      status: 413,
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it("counts raw UTF-8 bytes and caps chunked bodies", async () => {
    const chunks = ["{\"x\":\"", "한글한글", "\"}"];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    await expect(parseBoundedJsonBody(jsonRequest(stream), 12)).rejects.toMatchObject({
      code: "request_body_too_large",
    });
  });

  it("rejects malformed JSON and invalid Content-Length", async () => {
    await expect(parseBoundedJsonBody(jsonRequest("{"), 1024)).rejects.toMatchObject({
      code: "invalid_json",
    });
    await expect(parseBoundedJsonBody(jsonRequest("{}", { "content-length": "2x" }), 1024))
      .rejects.toMatchObject({ code: "invalid_content_length" });
  });
});

describe("data-surface inventory", () => {
  it("contains every current API and data-reading RSC boundary", () => {
    expect(DATA_SURFACE_INVENTORY).toEqual(expect.arrayContaining([
      "/api/chat",
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/session",
      "/api/admin/bootstrap",
      "/api/admin/overview",
      "/api/meetings",
      "/api/meetings/[id]",
      "/api/meetings/[id]/audio",
      "/api/meetings/[id]/content",
      "/api/meetings/[id]/export",
      "/api/meetings/[id]/finalize",
      "/api/meetings/[id]/reveal",
      "/api/meetings/[id]/review",
      "/api/meetings/[id]/summarize",
      "/api/meetings/[id]/summary",
      "/api/meetings/[id]/title",
      "/api/meetings/[id]/transcript",
      "/api/meetings/[id]/transcript/regenerate",
      "/api/knowledge/reindex",
      "/api/search",
      "/api/transcribe",
      "/api/glossary",
      "/api/settings/llm",
      "/api/settings/llm/health",
      "/api/settings/profile",
      "/api/realtime/temporary-key",
      "/meetings/[id]",
    ]));
    expect(new Set(DATA_SURFACE_INVENTORY).size).toBe(DATA_SURFACE_INVENTORY.length);
  });

  it("matches every route.ts on disk and requires the guard before request work", () => {
    const apiRoot = join(process.cwd(), "src", "app", "api");
    const routeFiles = (readdirSync(apiRoot, { recursive: true, encoding: "utf8" }) as string[])
      .filter((file) => file.endsWith("route.ts"))
      .sort();
    const routeInventory = DATA_SURFACE_INVENTORY.filter((path) => path.startsWith("/api/"))
      .map((path) => `${path.slice("/api/".length)}/route.ts`)
      .sort();
    expect(routeInventory).toEqual(routeFiles);
    for (const relativePath of routeFiles) {
      const source = readFileSync(join(apiRoot, relativePath), "utf8");
      const directGuardIndex = [
        source.indexOf("guardLocalApiRequest(request)"),
        source.indexOf("guardLoopbackApiRequest(request)"),
      ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
      const guardedBodyIndex = source.indexOf("readAccountJson(request)");
      const guardIndex = directGuardIndex >= 0 ? directGuardIndex : guardedBodyIndex;
      expect(guardIndex, relativePath).toBeGreaterThan(-1);
      const paramsIndex = source.indexOf("await params");
      if (paramsIndex >= 0) expect(guardIndex, relativePath).toBeLessThan(paramsIndex);
    }
  });
});

describe("account identity header", () => {
  const ACCOUNT = "181e8f1f-80d5-464d-83c1-e7ad416f90e3";

  it("activates the middleware-injected account tenant for ordinary data routes", async () => {
    const { accountTenantDataRoot, activeTenantDataRoot, baseDataRoot, runWithTenantDataRoot } =
      await import("@/lib/tenantDataContext");
    runWithTenantDataRoot(baseDataRoot(), () => {
      const denied = guardLocalApiRequest(request("/api/meetings", {
        headers: { "x-vision-account-id": ACCOUNT },
      }));
      expect(denied).toBeNull();
      expect(activeTenantDataRoot()).toBe(accountTenantDataRoot(ACCOUNT));
    });
  });

  it("never trusts the header on the streaming finalize route, which middleware cannot rewrite", async () => {
    const { activeTenantDataRoot, baseDataRoot, runWithTenantDataRoot } =
      await import("@/lib/tenantDataContext");
    runWithTenantDataRoot(baseDataRoot(), () => {
      const denied = guardLocalApiRequest(request("/api/meetings/meeting-1/finalize", {
        method: "POST",
        headers: { origin: BASE, "x-vision-account-id": ACCOUNT },
      }));
      expect(denied).toBeNull();
      expect(activeTenantDataRoot()).toBe(baseDataRoot());
    });
  });

  it("rejects a malformed account header instead of falling back to the shared root", () => {
    const denied = guardLocalApiRequest(request("/api/meetings", {
      headers: { "x-vision-account-id": "../escape" },
    }));
    expect(denied?.status).toBe(401);
  });
});
