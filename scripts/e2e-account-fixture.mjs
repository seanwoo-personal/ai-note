import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRealDirectory,
  resolveE2eSnapshotRoot,
} from "./e2e-harness.mjs";

const E2E_CUSTOMER_EMAIL = "customer@example.jp";
const E2E_CUSTOMER_PASSWORD = "CustomerPass!2026";

export const E2E_CUSTOMER_ID = "e2e-approved-customer";
const SESSION_TOKEN = "e2e-customer-session-token-with-sufficient-entropy-2026";

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

export async function installAccountFixture({ env = process.env } = {}) {
  const snapshotRoot = resolveE2eSnapshotRoot(env.AI_NOTE_E2E_SNAPSHOT_ROOT);
  await assertRealDirectory(snapshotRoot, "snapshot root");
  const dataRoot = join(snapshotRoot, "data");
  await assertRealDirectory(dataRoot, "account fixture data directory");

  const salt = randomBytes(16);
  const now = "2026-08-04T04:00:00.000Z";
  const expiresAt = "2099-12-31T23:59:59.000Z";
  const password = await derivePassword(E2E_CUSTOMER_PASSWORD, salt);
  const accountRoot = join(dataRoot, "system");
  await mkdir(accountRoot, { mode: 0o700 });
  await writeFile(join(accountRoot, "auth.json"), `${JSON.stringify({
    version: 1,
    accounts: [{
      id: E2E_CUSTOMER_ID,
      role: "customer",
      email: E2E_CUSTOMER_EMAIL,
      name: "합성 테스트 고객",
      companyName: "비전 합성 고객사",
      password: {
        algorithm: "scrypt-v1",
        salt: salt.toString("base64url"),
        hash: password.toString("base64url"),
      },
      access: "active",
      billingStatus: "paid",
      plan: "jpy",
      monthlyPrice: 1_500,
      currency: "JPY",
      totpSecret: null,
      recoveryCodeHashes: [],
      createdAt: now,
      approvedAt: now,
      approvedBy: "e2e-admin",
      lastLoginAt: null,
      temporaryPassword: null,
      passwordChangeRequired: false,
    }],
    sessions: [{
      tokenHash: tokenHash(SESSION_TOKEN),
      accountId: E2E_CUSTOMER_ID,
      kind: "customer",
      createdAt: now,
      expiresAt,
    }],
    invitations: [],
    usage: [],
    audit: [],
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

  const storageStatePath = join(snapshotRoot, ".e2e-customer-storage.json");
  await writeFile(storageStatePath, `${JSON.stringify({
    cookies: [{
      name: "vision_customer_session",
      value: SESSION_TOKEN,
      domain: "localhost",
      path: "/",
      expires: Math.floor(Date.parse(expiresAt) / 1_000),
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }],
    origins: [],
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return storageStatePath;
}
