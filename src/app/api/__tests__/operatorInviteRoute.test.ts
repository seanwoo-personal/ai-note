// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({ createOperatorInvitation: vi.fn() }));
const mailMocks = vi.hoisted(() => ({ configured: vi.fn(() => true), send: vi.fn() }));
const sessionMocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@/lib/accountStore", () => ({
  AccountStoreError: class AccountStoreError extends Error { constructor(readonly code: string) { super(code); } },
  ...storeMocks,
}));
vi.mock("@/services/smtpMail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/smtpMail")>()),
  smtpMailConfigured: mailMocks.configured,
}));
vi.mock("@/services/operatorInvitationEmail", () => ({ sendOperatorInvitationEmail: mailMocks.send }));
vi.mock("@/lib/accountSession", () => ({ resolveRequestSession: sessionMocks.resolve }));

import { POST as invite } from "@/app/api/admin/operators/invite/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/operators/invite", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("operator invite route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ORIGIN", "https://note.example.com");
    mailMocks.configured.mockReturnValue(true);
    sessionMocks.resolve.mockResolvedValue({ account: { id: "owner", role: "super_admin", name: "우상범" } });
    storeMocks.createOperatorInvitation.mockResolvedValue({ token: "tok", expiresAt: "2026-09-26T00:00:00.000Z" });
  });

  it("emails the setup link and reports email delivery, keeping the link as the manual fallback", async () => {
    const response = await invite(post({ name: "이우람", email: "operator@example.com" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      delivery: "email",
      sentTo: "operator@example.com",
      setupUrl: "https://note.example.com/admin/accept?token=tok",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    expect(mailMocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "operator@example.com", name: "이우람", invitedBy: "우상범", setupUrl: "https://note.example.com/admin/accept?token=tok",
    }));
  });

  it("falls back to the link when mail is not configured or delivery fails", async () => {
    mailMocks.configured.mockReturnValue(false);
    let body = await (await invite(post({ name: "이우람", email: "operator@example.com" }))).json();
    expect(body).toMatchObject({ ok: true, delivery: "link", setupUrl: expect.stringContaining("/admin/accept?token=tok") });
    expect(mailMocks.send).not.toHaveBeenCalled();

    mailMocks.configured.mockReturnValue(true);
    mailMocks.send.mockRejectedValueOnce(new Error("smtp down"));
    body = await (await invite(post({ name: "이우람", email: "operator@example.com" }))).json();
    expect(body).toMatchObject({ ok: true, delivery: "link_after_mail_failure" });
  });

  it("stays super-admin only", async () => {
    sessionMocks.resolve.mockResolvedValue({ account: { id: "op", role: "operator", name: "운영자" } });
    expect((await invite(post({ name: "x", email: "x@example.com" }))).status).toBe(403);
    expect(storeMocks.createOperatorInvitation).not.toHaveBeenCalled();
  });
});
