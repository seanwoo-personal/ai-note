import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptOperatorInvitation,
  approveCustomer,
  bootstrapSuperAdmin,
  changeCustomerPassword,
  createCustomerApplication,
  createOperatorInvitation,
  authenticateCustomer,
  issueSession,
  readAccountStore,
  requestCustomerTemporaryPassword,
  resetAdminMfa,
  resolveSession,
  setCustomerBilling,
} from "@/lib/accountStore";
import { hashPassword, verifyPassword } from "@/lib/passwordSecurity";
import { generateTotpSecret, totpAt, verifyTotp } from "@/lib/totp";

describe("account access store", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ai-note-account-test-"));
  });

  it("keeps a customer blocked until both approval and payment are present", async () => {
    const customer = await createCustomerApplication({
      companyName: "비전 일본 고객사",
      contactName: "야마다 타로",
      email: "customer@example.jp",
      password: "CustomerPass!2026",
      plan: "jpy",
    }, root);

    expect(customer.access).toBe("pending_approval");
    await approveCustomer(customer.id, "admin-1", root);
    expect((await readAccountStore(root)).accounts.find((item) => item.id === customer.id)?.access).toBe("payment_required");

    await setCustomerBilling(customer.id, "paid", "admin-1", root);
    expect((await readAccountStore(root)).accounts.find((item) => item.id === customer.id)?.access).toBe("active");
  });

  it("normalizes email and refuses a duplicate application", async () => {
    const input = {
      companyName: "고객사",
      contactName: "담당자",
      email: "Customer@Example.JP",
      password: "CustomerPass!2026",
      plan: "usd" as const,
    };
    await createCustomerApplication(input, root);

    await expect(createCustomerApplication({ ...input, email: " customer@example.jp " }, root))
      .rejects.toMatchObject({ code: "email_already_exists" });
  });

  it("stores only password derivation material and verifies it with timing-safe comparison", async () => {
    const password = "AdminPass!2026";
    const record = await hashPassword(password);

    expect(record.hash).not.toContain(password);
    expect(await verifyPassword(password, record)).toBe(true);
    expect(await verifyPassword("wrong-password", record)).toBe(false);
  });

  it("issues a hashed one-time temporary password and requires a permanent replacement", async () => {
    const customer = await createCustomerApplication({
      companyName: "비전 일본 고객사",
      contactName: "야마다 타로",
      email: "customer@example.jp",
      password: "CustomerPass!2026",
      plan: "jpy",
    }, root);
    await approveCustomer(customer.id, "admin-1", root);
    await setCustomerBilling(customer.id, "paid", "admin-1", root);

    const reset = await requestCustomerTemporaryPassword(customer.email, root);
    expect(reset).not.toBeNull();
    expect(reset?.temporaryPassword).toMatch(/^[A-Za-z0-9!@#$%*-]+$/u);
    expect(reset?.expiresAt).toBeTruthy();
    expect(await readFile(join(root, "auth.json"), "utf8")).not.toContain(reset?.temporaryPassword);

    const authenticated = await authenticateCustomer(customer.email, reset!.temporaryPassword, root);
    expect(authenticated.passwordChangeRequired).toBe(true);
    await expect(authenticateCustomer(customer.email, reset!.temporaryPassword, root))
      .rejects.toMatchObject({ code: "invalid_credentials" });

    const session = await issueSession(customer.id, "customer", 600, root);
    await changeCustomerPassword(customer.id, "ReplacementPass!2026", root);
    expect(await resolveSession(session.token, "customer", root)).toBeNull();
    expect((await authenticateCustomer(customer.email, "ReplacementPass!2026", root)).passwordChangeRequired).toBe(false);
  });

  it("expires a temporary password after thirty minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T04:00:00.000Z"));
    try {
      const customer = await createCustomerApplication({
        companyName: "고객사",
        contactName: "담당자",
        email: "expired@example.jp",
        password: "CustomerPass!2026",
        plan: "usd",
      }, root);
      await approveCustomer(customer.id, "admin-1", root);
      await setCustomerBilling(customer.id, "paid", "admin-1", root);
      const reset = await requestCustomerTemporaryPassword(customer.email, root);

      vi.advanceTimersByTime(30 * 60 * 1_000 + 1);
      await expect(authenticateCustomer(customer.email, reset!.temporaryPassword, root))
        .rejects.toMatchObject({ code: "invalid_credentials" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a one-time operator invitation and provisions TOTP on acceptance", async () => {
    const admin = await bootstrapSuperAdmin({
      name: "최고 운영자",
      email: "admin@vision.local",
      password: "AdminPass!2026",
    }, root);
    const invitation = await createOperatorInvitation({
      name: "운영 담당자",
      email: "operator@vision.local",
      invitedBy: admin.account.id,
    }, root);

    const accepted = await acceptOperatorInvitation({
      token: invitation.token,
      password: "OperatorPass!2026",
    }, root);
    expect(accepted.account.role).toBe("operator");
    expect(accepted.totpSecret).toMatch(/^[A-Z2-7]+$/u);

    await expect(acceptOperatorInvitation({
      token: invitation.token,
      password: "AnotherPass!2026",
    }, root)).rejects.toMatchObject({ code: "invitation_invalid" });
  });

  it("stores an opaque session hash and expires sessions absolutely", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T04:00:00.000Z"));
    try {
      const admin = await bootstrapSuperAdmin({
        name: "최고 운영자",
        email: "admin@vision.local",
        password: "AdminPass!2026",
      }, root);
      const issued = await issueSession(admin.account.id, "admin", 60, root);
      const file = await readFile(join(root, "auth.json"), "utf8");
      expect(file).not.toContain(issued.token);
      expect((await resolveSession(issued.token, "admin", root))?.account.id).toBe(admin.account.id);

      vi.advanceTimersByTime(61_000);
      expect(await resolveSession(issued.token, "admin", root)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotates an administrator's MFA secret and invalidates existing sessions", async () => {
    const password = "AdminPass!2026";
    const admin = await bootstrapSuperAdmin({
      name: "최고 운영자",
      email: "admin@vision.local",
      password,
    }, root);
    const issued = await issueSession(admin.account.id, "admin", 600, root);

    const reset = await resetAdminMfa({ email: admin.account.email, password }, root);
    expect(reset.totpSecret).not.toBe(admin.totpSecret);
    expect(reset.recoveryCodes).toHaveLength(8);
    expect(await resolveSession(issued.token, "admin", root)).toBeNull();

    await expect(resetAdminMfa({
      email: admin.account.email,
      password: "WrongPass!2026",
    }, root)).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("operator TOTP", () => {
  it("accepts the current 30 second code and rejects a distant code", () => {
    const secret = generateTotpSecret(() => Buffer.alloc(20, 7));
    const now = Date.parse("2026-08-04T04:00:00.000Z");
    const current = totpAt(secret, now);
    const distant = totpAt(secret, now + 120_000);

    expect(verifyTotp(secret, current, now)).toBe(true);
    expect(verifyTotp(secret, distant, now)).toBe(false);
  });
});
