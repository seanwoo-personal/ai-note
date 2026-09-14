// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const accountMocks = vi.hoisted(() => ({
  cancelCustomerTemporaryPassword: vi.fn(),
  changeCustomerPassword: vi.fn(),
  issueSession: vi.fn(),
  publicAccount: vi.fn((account: unknown) => account),
  requestCustomerTemporaryPassword: vi.fn(),
}));
const mailMocks = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  send: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock("@/lib/accountStore", () => ({
  AccountStoreError: class AccountStoreError extends Error { constructor(readonly code: string) { super(code); } },
  ...accountMocks,
}));
vi.mock("@/services/passwordRecoveryEmail", () => ({
  passwordRecoveryEmailConfigured: mailMocks.configured,
  sendCustomerTemporaryPasswordEmail: mailMocks.send,
}));
vi.mock("@/lib/accountSession", () => ({
  resolveRequestSession: sessionMocks.resolve,
  setSessionCookie: sessionMocks.setCookie,
}));

import { POST as forgotPassword } from "@/app/api/auth/password/forgot/route";
import { POST as changePassword } from "@/app/api/auth/password/change/route";

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("customer password recovery routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailMocks.configured.mockReturnValue(true);
  });

  it("sends a temporary password but returns an enumeration-safe response", async () => {
    accountMocks.requestCustomerTemporaryPassword.mockResolvedValue({
      requestId: "request-1",
      accountId: "customer-1",
      email: "customer@example.jp",
      name: "야마다 타로",
      temporaryPassword: "T9!TemporaryPass",
      expiresAt: "2026-08-19T04:30:00.000Z",
    });
    const response = await forgotPassword(post("/api/auth/password/forgot", { email: "customer@example.jp" }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: "가입된 이메일이라면 임시 비밀번호를 발송했습니다." });
    expect(mailMocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "customer@example.jp" }));
  });

  it("returns the same response when no customer account exists", async () => {
    accountMocks.requestCustomerTemporaryPassword.mockResolvedValue(null);
    const response = await forgotPassword(post("/api/auth/password/forgot", { email: "unknown@example.jp" }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: "가입된 이메일이라면 임시 비밀번호를 발송했습니다." });
    expect(mailMocks.send).not.toHaveBeenCalled();
  });

  it("changes the password only for a temporary-password session and rotates the session", async () => {
    const account = { id: "customer-1", role: "customer", passwordChangeRequired: true };
    sessionMocks.resolve.mockResolvedValue({ account, expiresAt: "2026-08-20T00:00:00.000Z" });
    accountMocks.issueSession.mockResolvedValue({ token: "new-session", expiresAt: "2026-08-20T00:00:00.000Z" });
    const response = await changePassword(post("/api/auth/password/change", {
      password: "ReplacementPass!2026",
      confirmation: "ReplacementPass!2026",
    }));

    expect(response.status).toBe(200);
    expect(accountMocks.changeCustomerPassword).toHaveBeenCalledWith("customer-1", "ReplacementPass!2026");
    expect(sessionMocks.setCookie).toHaveBeenCalledWith(response, "customer", "new-session", "2026-08-20T00:00:00.000Z", expect.any(Request));
  });
});
