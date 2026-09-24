import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptOperatorInvitation,
  bootstrapSuperAdmin,
  createCustomerApplication,
  createOperatorInvitation,
  issueSession,
  readAccountStore,
  resolveSession,
  revokeOperator,
} from "@/lib/accountStore";

async function seedOperator(root: string) {
  const owner = await bootstrapSuperAdmin({ name: "Owner", email: "owner@example.com", password: "OwnerPass!2026" }, root);
  const invitation = await createOperatorInvitation({ name: "Woo Ram", email: "operator@example.com", invitedBy: owner.account.id }, root);
  const accepted = await acceptOperatorInvitation({ token: invitation.token, password: "OperatorPass!2026" }, root);
  return { owner: owner.account, operator: accepted.account };
}

describe("operator revocation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ai-note-operator-test-"));
  });

  it("removes the operator, drops its admin sessions, and records the audit entry", async () => {
    const { owner, operator } = await seedOperator(root);
    const session = await issueSession(operator.id, "admin", 3600, root);
    expect(await resolveSession(session.token, "admin", root)).not.toBeNull();

    await revokeOperator(operator.id, owner.id, root);

    const document = await readAccountStore(root);
    expect(document.accounts.some((item) => item.id === operator.id)).toBe(false);
    expect(await resolveSession(session.token, "admin", root)).toBeNull();
    expect(document.audit.at(-1)).toMatchObject({ action: "operator.revoked", actorId: owner.id, targetId: operator.id });
  });

  it("frees the email so the same person can be invited again", async () => {
    const { owner, operator } = await seedOperator(root);
    await revokeOperator(operator.id, owner.id, root);
    await expect(createOperatorInvitation({ name: "Woo Ram", email: operator.email, invitedBy: owner.id }, root)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("refuses to revoke the super admin, a customer, or an unknown id", async () => {
    const { owner } = await seedOperator(root);
    const customer = await createCustomerApplication({
      companyName: "비전", contactName: "고객", email: "customer@example.jp", password: "CustomerPass!2026", plan: "jpy",
    }, root);
    await expect(revokeOperator(owner.id, owner.id, root)).rejects.toMatchObject({ code: "account_not_found" });
    await expect(revokeOperator(customer.id, owner.id, root)).rejects.toMatchObject({ code: "account_not_found" });
    await expect(revokeOperator("missing", owner.id, root)).rejects.toMatchObject({ code: "account_not_found" });
    expect((await readAccountStore(root)).accounts).toHaveLength(3);
  });
});
