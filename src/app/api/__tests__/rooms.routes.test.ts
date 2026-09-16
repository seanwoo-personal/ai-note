// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/accountSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accountSession")>()),
  resolveRequestSession: sessionMocks.resolve,
}));

import { POST as createRoomPOST } from "@/app/api/rooms/route";
import { POST as joinPOST } from "@/app/api/rooms/join/[token]/route";
import { GET as roomGET } from "@/app/api/rooms/[id]/route";
import { POST as endPOST } from "@/app/api/rooms/[id]/end/route";
import { GET as eventsGET } from "@/app/api/rooms/[id]/events/route";
import { GET as exportGET } from "@/app/api/rooms/[id]/export/route";
import { POST as rotatePOST } from "@/app/api/rooms/[id]/invite/rotate/route";
import { POST as utterancePOST } from "@/app/api/rooms/[id]/utterances/route";
import { PATCH as speakerPATCH } from "@/app/api/rooms/[id]/utterances/[utteranceId]/speaker/route";
import { resetArtifactLeaseStateForTests } from "@/lib/artifactLease";
import { resolveGuestSession } from "@/lib/guestSession";
import { resetLibraryRepositoryStateForTests } from "@/lib/library";
import { resetMeetingLifecycleForTests } from "@/lib/meetingLifecycle";
import { resetMeetingTombstoneStateForTests } from "@/lib/meetingTombstone";
import { resetRoomEventHubForTests } from "@/lib/roomEventHub";
import { readRoomEvents } from "@/lib/roomStore";
import { writeSettings } from "@/lib/settings";
import { resetStatusUpdaterStateForTests } from "@/lib/statusUpdater";
import { accountTenantDataRoot, runWithAccountTenantData } from "@/lib/tenantDataContext";

const ORIGIN = "http://127.0.0.1:3000";
const HOST = "11111111-1111-4111-8111-111111111111";
const OTHER_HOST = "22222222-2222-4222-8222-222222222222";

function hostRequest(path: string, init: RequestInit & { json?: unknown } = {}, accountId = HOST): Request {
  const { json, ...rest } = init;
  return new Request(`${ORIGIN}${path}`, {
    ...rest,
    headers: {
      host: "127.0.0.1:3000",
      origin: ORIGIN,
      "x-vision-account-id": accountId,
      "x-vision-account-role": "customer",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
}

function guestRequest(path: string, guest: { cookie: string; meetingId: string; accountId?: string }, init: RequestInit & { json?: unknown } = {}): Request {
  const { json, ...rest } = init;
  return new Request(`${ORIGIN}${path}`, {
    ...rest,
    headers: {
      host: "127.0.0.1:3000",
      origin: ORIGIN,
      cookie: `vision_guest_session=${guest.cookie}`,
      "x-vision-account-id": guest.accountId ?? HOST,
      "x-vision-account-role": "guest",
      "x-vision-guest-room": guest.meetingId,
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
}

function publicRequest(path: string, json: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(json),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(/vision_guest_session=([^;]+)/u);
  expect(match, "guest cookie set").not.toBeNull();
  return match![1];
}

async function createRoom(mode: "remote" | "same_room" = "remote") {
  const response = await runWithAccountTenantData(HOST, () => createRoomPOST(hostRequest("/api/rooms", {
    method: "POST",
    json: { title: "Vision 정기 미팅", mode, hostLanguage: "ko" },
  })));
  expect(response.status).toBe(200);
  const body = await response.json() as { id: string; invite: { url: string; password: string; expiresPolicy: string } };
  const token = body.invite.url.split("/join/")[1];
  return { id: body.id, token, password: body.invite.password, body };
}

async function joinAsGuest(token: string, password: string, name = "Alex", language: "ko" | "en" | "ja" | "zh" = "en") {
  const response = await joinPOST(publicRequest(`/api/rooms/join/${token}`, { name, password, language }), tokenCtx(token));
  return response;
}

let originalCwd: string;
let workDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "rooms-routes-"));
  process.chdir(workDir);
  process.env.FAKE_LLM = "1";
  process.env.AI_NOTE_DISABLE_WORKER = "1";
  delete process.env.AI_NOTE_DEPLOYMENT_MODE;
  delete process.env.APP_ORIGIN;
  sessionMocks.resolve.mockReset();
  sessionMocks.resolve.mockResolvedValue({
    account: { id: HOST, role: "customer", name: "김민수", passwordChangeRequired: false },
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  resetArtifactLeaseStateForTests();
  resetLibraryRepositoryStateForTests();
  resetMeetingLifecycleForTests();
  resetMeetingTombstoneStateForTests();
  resetStatusUpdaterStateForTests();
  resetRoomEventHubForTests();
  await writeSettings({ provider: "openrouter" });
});

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.FAKE_LLM;
  delete process.env.AI_NOTE_DISABLE_WORKER;
  resetArtifactLeaseStateForTests();
  resetLibraryRepositoryStateForTests();
  resetMeetingLifecycleForTests();
  resetMeetingTombstoneStateForTests();
  resetStatusUpdaterStateForTests();
  resetRoomEventHubForTests();
  rmSync(workDir, { recursive: true, force: true });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout");
}

describe("interpreter room routes", () => {
  it("creates a room under the host tenant and returns an invite with URL, password, and policy", async () => {
    const { id, token, password, body } = await createRoom();
    expect(body.invite.url).toBe(`${ORIGIN}/join/${token}`);
    expect(password).toMatch(/^[A-Za-z2-9]{8}$/u);
    expect(body.invite.expiresPolicy).toBe("24h_after_end");
    expect(existsSync(join(accountTenantDataRoot(HOST), "meetings", id, "room.json"))).toBe(true);
    expect(existsSync(join(workDir, "data", "meetings", id))).toBe(false);
  });

  it("refuses room creation without a host identity", async () => {
    const response = await createRoomPOST(new Request(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ mode: "remote", hostLanguage: "ko" }),
    }));
    expect(response.status).toBe(401);
  });

  it("lets a guest join with name + password and answers unknown link, wrong password, and rate limit safely", async () => {
    const { id, token, password } = await createRoom();

    const wrong = await joinAsGuest(token, "WrongPass1");
    expect(wrong.status).toBe(401);
    const unknown = await joinAsGuest("unknown-token-with-enough-length", password);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());

    const joined = await joinAsGuest(token, password);
    expect(joined.status).toBe(200);
    const cookie = cookieFrom(joined);
    await expect(joined.json()).resolves.toMatchObject({
      id,
      room: { me: { role: "guest", name: "Alex", language: "en" }, participants: [{ role: "host" }, { role: "guest", name: "Alex" }] },
    });
    await expect(resolveGuestSession(cookie)).resolves.toMatchObject({ hostAccountId: HOST, meetingId: id, name: "Alex" });

    // Five attempts are already spent on this token (wrong, joined = 2); exhaust the rest.
    for (let index = 0; index < 3; index += 1) await joinAsGuest(token, "WrongPass1");
    const limited = await joinAsGuest(token, password);
    expect(limited.status).toBe(429);
  });

  it("scopes a guest to its own room and rejects host-only actions", async () => {
    const first = await createRoom();
    const second = await createRoom();
    const joined = await joinAsGuest(first.token, first.password);
    const cookie = cookieFrom(joined);
    const guest = { cookie, meetingId: first.id };

    const own = await runWithAccountTenantData(HOST, () => roomGET(guestRequest(`/api/rooms/${first.id}`, guest), ctx(first.id)));
    expect(own.status).toBe(200);
    const other = await runWithAccountTenantData(HOST, () => roomGET(guestRequest(`/api/rooms/${second.id}`, guest), ctx(second.id)));
    expect(other.status).toBe(404);
    const rotate = await runWithAccountTenantData(HOST, () => rotatePOST(guestRequest(`/api/rooms/${first.id}/invite/rotate`, guest, { method: "POST" }), ctx(first.id)));
    expect(rotate.status).toBe(404);
    const end = await runWithAccountTenantData(HOST, () => endPOST(guestRequest(`/api/rooms/${first.id}/end`, guest, { method: "POST" }), ctx(first.id)));
    expect(end.status).toBe(404);
  });

  it("never lets another host read a room outside its tenant", async () => {
    const { id } = await createRoom();
    const response = await runWithAccountTenantData(OTHER_HOST, () => roomGET(hostRequest(`/api/rooms/${id}`, {}, OTHER_HOST), ctx(id)));
    expect(response.status).toBe(404);
  });

  it("attributes utterances, translates them in the background, and streams everything over SSE with replay", async () => {
    const { id, token, password } = await createRoom();
    const joined = await joinAsGuest(token, password);
    const guest = { cookie: cookieFrom(joined), meetingId: id };

    const hostSaid = await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${id}/utterances`, {
      method: "POST",
      json: { utteranceId: "u1", original: "안녕하세요, 시작할까요?", sourceLanguage: "ko" },
    }), ctx(id)));
    expect(hostSaid.status).toBe(200);
    await expect(hostSaid.json()).resolves.toMatchObject({ accepted: true, speaker: "host", rule: "origin", pendingTranslations: ["en"] });

    const guestSaid = await runWithAccountTenantData(HOST, () => utterancePOST(guestRequest(`/api/rooms/${id}/utterances`, guest, {
      method: "POST",
      json: { utteranceId: "u2", original: "Yes, let's begin.", sourceLanguage: "en" },
    }), ctx(id)));
    await expect(guestSaid.json()).resolves.toMatchObject({ speaker: "guest", rule: "origin", pendingTranslations: ["ko"] });

    const duplicate = await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${id}/utterances`, {
      method: "POST",
      json: { utteranceId: "u1", original: "안녕하세요, 시작할까요?", sourceLanguage: "ko" },
    }), ctx(id)));
    await expect(duplicate.json()).resolves.toMatchObject({ accepted: true, duplicate: true });

    await runWithAccountTenantData(HOST, () => waitFor(async () => {
      const { events } = await readRoomEvents(id);
      return events.filter((event) => event.type === "translation").length === 2;
    }));

    const controller = new AbortController();
    const stream = await runWithAccountTenantData(HOST, () => eventsGET(hostRequest(`/api/rooms/${id}/events`, {
      headers: { "last-event-id": "1" },
      signal: controller.signal,
    }), ctx(id)));
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    let received = "";
    while (!received.includes("id: 5\n") && !received.includes("event: translation\ndata")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += new TextDecoder().decode(value);
      if (received.split("\n\n").filter((chunk) => chunk.startsWith("id:")).length >= 4) break;
    }
    controller.abort();
    expect(received).not.toContain("id: 1\n");
    expect(received).toContain("event: utterance");
    expect(received).toContain("event: translation");
  });

  it("stores a live translation from the device immediately and skips the model for that language", async () => {
    const { id, token, password } = await createRoom();
    await joinAsGuest(token, password);
    const said = await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${id}/utterances`, {
      method: "POST",
      json: {
        utteranceId: "u-live", original: "안녕하세요", sourceLanguage: "ko",
        liveTranslation: { language: "en", text: "Hello (live)" },
      },
    }), ctx(id)));
    expect(said.status).toBe(200);
    await expect(said.json()).resolves.toMatchObject({ accepted: true, pendingTranslations: [] });
    const { events } = await runWithAccountTenantData(HOST, () => readRoomEvents(id));
    expect(events.filter((event) => event.type === "translation")).toEqual([
      expect.objectContaining({ utteranceId: "u-live", language: "en", text: "Hello (live)" }),
    ]);
    // Give any (unexpected) background translation a moment; none may appear.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const again = await runWithAccountTenantData(HOST, () => readRoomEvents(id));
    expect(again.events.filter((event) => event.type === "translation")).toHaveLength(1);
  });

  it("allows manual speaker correction only in a shared room and only for known utterances", async () => {
    const remote = await createRoom("remote");
    const shared = await createRoom("same_room");
    for (const room of [remote, shared]) {
      const said = await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${room.id}/utterances`, {
        method: "POST",
        json: { utteranceId: "u1", original: "Let's go", sourceLanguage: "en", speakerLabel: "2" },
      }), ctx(room.id)));
      expect(said.status).toBe(200);
    }
    const patchCtx = (id: string, utteranceId: string) => ({ params: Promise.resolve({ id, utteranceId }) });
    const remoteFix = await runWithAccountTenantData(HOST, () => speakerPATCH(hostRequest(`/api/rooms/${remote.id}/utterances/u1/speaker`, {
      method: "PATCH", json: { speaker: "guest" },
    }), patchCtx(remote.id, "u1")));
    expect(remoteFix.status).toBe(400);
    const sharedFix = await runWithAccountTenantData(HOST, () => speakerPATCH(hostRequest(`/api/rooms/${shared.id}/utterances/u1/speaker`, {
      method: "PATCH", json: { speaker: "guest" },
    }), patchCtx(shared.id, "u1")));
    expect(sharedFix.status).toBe(200);
    const missing = await runWithAccountTenantData(HOST, () => speakerPATCH(hostRequest(`/api/rooms/${shared.id}/utterances/nope/speaker`, {
      method: "PATCH", json: { speaker: "guest" },
    }), patchCtx(shared.id, "nope")));
    expect(missing.status).toBe(404);
  });

  it("ends the room, publishes transcript + minutes as a host meeting, and serves guest downloads in the chosen language", async () => {
    const { id, token, password } = await createRoom();
    const joined = await joinAsGuest(token, password);
    const guest = { cookie: cookieFrom(joined), meetingId: id };
    await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${id}/utterances`, {
      method: "POST", json: { utteranceId: "u1", original: "다음 주 일정 확인 부탁드립니다.", sourceLanguage: "ko" },
    }), ctx(id)));
    await runWithAccountTenantData(HOST, () => waitFor(async () => (await readRoomEvents(id)).events.some((event) => event.type === "translation")));

    const ended = await runWithAccountTenantData(HOST, () => endPOST(hostRequest(`/api/rooms/${id}/end`, { method: "POST" }), ctx(id)));
    expect(ended.status).toBe(200);
    const endedBody = await ended.json() as { endedAt: string; guestExpiresAt: string; meeting: { id: string; status: string } | null };
    expect(endedBody.meeting).toMatchObject({ id, status: "summarized" });
    expect(Date.parse(endedBody.guestExpiresAt) - Date.parse(endedBody.endedAt)).toBe(24 * 60 * 60 * 1_000);
    expect(existsSync(join(accountTenantDataRoot(HOST), "meetings", id, "summary.json"))).toBe(true);

    const late = await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${id}/utterances`, {
      method: "POST", json: { utteranceId: "u9", original: "late", sourceLanguage: "ko" },
    }), ctx(id)));
    expect(late.status).toBe(409);

    const transcript = await runWithAccountTenantData(HOST, () => exportGET(guestRequest(`/api/rooms/${id}/export?kind=transcript`, guest), ctx(id)));
    expect(transcript.status).toBe(200);
    const transcriptText = await transcript.text();
    expect(transcriptText).toContain("김민수 (한국어)");
    expect(transcriptText).toContain("- English:");

    const minutesHost = await runWithAccountTenantData(HOST, () => exportGET(guestRequest(`/api/rooms/${id}/export?kind=minutes&language=ko`, guest), ctx(id)));
    expect(minutesHost.status).toBe(200);
    expect(await minutesHost.text()).toContain("통역 회의실 회의록");

    const minutesEn = await runWithAccountTenantData(HOST, () => exportGET(guestRequest(`/api/rooms/${id}/export?kind=minutes&language=en`, guest), ctx(id)));
    expect(minutesEn.status).toBe(200);
    expect(minutesEn.headers.get("content-disposition")).toContain("minutes-en.md");
    expect(existsSync(join(accountTenantDataRoot(HOST), "meetings", id, "summary.en.md"))).toBe(true);
    expect(existsSync(join(accountTenantDataRoot(HOST), "meetings", id, "summary.json"))).toBe(true);
  });

  it("answers the join probe with 404 for unknown links, form for a fresh valid link, and the seat for a returning guest", async () => {
    const { token, password, id } = await createRoom();
    const probe = (path: string, cookie?: string) => new Request(`${ORIGIN}${path}`, {
      headers: { host: "127.0.0.1:3000", ...(cookie ? { cookie: `vision_guest_session=${cookie}` } : {}) },
    });
    const { GET: joinGET } = await import("@/app/api/rooms/join/[token]/route");
    expect((await joinGET(probe("/api/rooms/join/not-a-real-token-xxxxxxxx"), tokenCtx("not-a-real-token-xxxxxxxx"))).status).toBe(404);
    expect((await joinGET(probe("/api/rooms/join/short"), tokenCtx("short"))).status).toBe(404);
    const fresh = await joinGET(probe(`/api/rooms/join/${token}`), tokenCtx(token));
    expect(fresh.status).toBe(200);
    await expect(fresh.json()).resolves.toEqual({ state: "form" });
    const joined = await joinAsGuest(token, password, "Alex", "ja");
    const cookie = cookieFrom(joined);
    const seated = await joinGET(probe(`/api/rooms/join/${token}`, cookie), tokenCtx(token));
    await expect(seated.json()).resolves.toEqual({ state: "session", id, name: "Alex", language: "ja" });
  });

  it("delivers downloads as Markdown, Word, or a print page and replaces the seat name on re-entry", async () => {
    const { id, token, password } = await createRoom();
    const first = await joinAsGuest(token, password, "Alex");
    const guest = { cookie: cookieFrom(first), meetingId: id };
    await runWithAccountTenantData(HOST, () => utterancePOST(hostRequest(`/api/rooms/${id}/utterances`, {
      method: "POST", json: { utteranceId: "u1", original: "다음 주 일정 확인 부탁드립니다.", sourceLanguage: "ko", liveTranslation: { language: "en", text: "Please check next week's schedule." } },
    }), ctx(id)));
    const renamed = await joinAsGuest(token, password, "Alexander");
    expect(renamed.status).toBe(200);
    const room = await runWithAccountTenantData(HOST, () => roomGET(hostRequest(`/api/rooms/${id}`), ctx(id)));
    await expect(room.json()).resolves.toMatchObject({ participants: [{ role: "host" }, { role: "guest", name: "Alexander" }] });
    const { events } = await runWithAccountTenantData(HOST, () => readRoomEvents(id));
    expect(events.filter((event) => event.type === "participant").map((event) => event.type === "participant" && event.name)).toEqual(["Alex", "Alexander"]);

    await runWithAccountTenantData(HOST, () => endPOST(hostRequest(`/api/rooms/${id}/end`, { method: "POST" }), ctx(id)));
    const docx = await runWithAccountTenantData(HOST, () => exportGET(guestRequest(`/api/rooms/${id}/export?kind=minutes&language=ko&format=docx`, guest), ctx(id)));
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    expect(docx.headers.get("content-disposition")).toContain("minutes-ko.docx");
    const bytes = new Uint8Array(await docx.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const html = await runWithAccountTenantData(HOST, () => exportGET(guestRequest(`/api/rooms/${id}/export?kind=transcript&language=en&format=html`, guest), ctx(id)));
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-disposition")).toContain("inline");
    const page = await html.text();
    expect(page).toContain("window.print()");
    expect(page).toContain("Please check next week");
    const bad = await runWithAccountTenantData(HOST, () => exportGET(guestRequest(`/api/rooms/${id}/export?kind=minutes&format=pdf`, guest), ctx(id)));
    expect(bad.status).toBe(400);
  });

  it("rotating the invite invalidates the old link and existing guest sessions", async () => {
    const { id, token, password } = await createRoom();
    const joined = await joinAsGuest(token, password);
    const cookie = cookieFrom(joined);
    const rotated = await runWithAccountTenantData(HOST, () => rotatePOST(hostRequest(`/api/rooms/${id}/invite/rotate`, { method: "POST" }), ctx(id)));
    expect(rotated.status).toBe(200);
    const body = await rotated.json() as { invite: { url: string; password: string } };
    expect(body.invite.url).not.toContain(token);
    await expect(resolveGuestSession(cookie)).resolves.toBeNull();
    const oldLink = await joinAsGuest(token, password);
    expect(oldLink.status).toBe(401);
    const newLink = await joinAsGuest(body.invite.url.split("/join/")[1], body.invite.password);
    expect(newLink.status).toBe(200);
  });
});
