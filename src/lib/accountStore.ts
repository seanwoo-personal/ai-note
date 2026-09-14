import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

import { atomicWriteFile } from "@/lib/atomicWrite";
import {
  hashPassword,
  passwordMeetsPolicy,
  verifyPassword,
  type PasswordRecord,
} from "@/lib/passwordSecurity";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";

export type AccountRole = "customer" | "operator" | "super_admin";
export type CustomerAccess = "pending_approval" | "payment_required" | "active" | "blocked";
export type BillingStatus = "unpaid" | "paid" | "overdue";
export type Plan = "jpy" | "usd";
export type SessionKind = "customer" | "admin";
export type UsageKind = "login" | "recording" | "summary" | "realtime_session" | "translation";

interface TemporaryPasswordRecord {
  requestId: string;
  password: PasswordRecord;
  createdAt: string;
  expiresAt: string;
}

export interface AccountRecord {
  id: string;
  role: AccountRole;
  email: string;
  name: string;
  companyName: string | null;
  password: PasswordRecord;
  access: CustomerAccess;
  billingStatus: BillingStatus;
  plan: Plan | null;
  monthlyPrice: number | null;
  currency: "JPY" | "USD" | null;
  totpSecret: string | null;
  recoveryCodeHashes: string[];
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  lastLoginAt: string | null;
  temporaryPassword?: TemporaryPasswordRecord | null;
  passwordChangeRequired?: boolean;
}

interface SessionRecord {
  tokenHash: string;
  accountId: string;
  kind: SessionKind;
  createdAt: string;
  expiresAt: string;
}

interface InvitationRecord {
  tokenHash: string;
  name: string;
  email: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface UsageRecord {
  id: string;
  accountId: string;
  kind: UsageKind;
  units: number;
  occurredAt: string;
}

interface AuditRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetId: string | null;
  occurredAt: string;
}

export interface AccountStoreDocument {
  version: 1;
  accounts: AccountRecord[];
  sessions: SessionRecord[];
  invitations: InvitationRecord[];
  usage: UsageRecord[];
  audit: AuditRecord[];
}

export class AccountStoreError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AccountStoreError";
    this.code = code;
  }
}

const mutationQueues = new Map<string, Promise<unknown>>();

export function accountDataRoot(): string {
  return join(process.cwd(), "data", "system");
}

function storePath(root: string): string {
  return join(root, "auth.json");
}

function secretPath(root: string): string {
  return join(root, "server-secret");
}

function emptyDocument(): AccountStoreDocument {
  return { version: 1, accounts: [], sessions: [], invitations: [], usage: [], audit: [] };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function deriveCustomerAccess(input: Pick<AccountRecord, "role" | "access" | "billingStatus" | "approvedAt">): CustomerAccess {
  if (input.role !== "customer") return "active";
  if (input.access === "blocked") return "blocked";
  if (!input.approvedAt) return "pending_approval";
  return input.billingStatus === "paid" ? "active" : "payment_required";
}

function normalizeDocument(value: unknown): AccountStoreDocument {
  if (!value || typeof value !== "object") throw new AccountStoreError("store_corrupt");
  const document = value as Partial<AccountStoreDocument>;
  if (
    document.version !== 1
    || !Array.isArray(document.accounts)
    || !Array.isArray(document.sessions)
    || !Array.isArray(document.invitations)
    || !Array.isArray(document.usage)
    || !Array.isArray(document.audit)
  ) throw new AccountStoreError("store_corrupt");
  return document as AccountStoreDocument;
}

export async function readAccountStore(root = accountDataRoot()): Promise<AccountStoreDocument> {
  try {
    return normalizeDocument(JSON.parse(await readFile(storePath(root), "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDocument();
    if (error instanceof AccountStoreError) throw error;
    throw new AccountStoreError("store_corrupt");
  }
}

async function mutateStore<T>(
  root: string,
  mutation: (document: AccountStoreDocument) => Promise<T> | T,
): Promise<T> {
  const previous = mutationQueues.get(root) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const document = await readAccountStore(root);
    const result = await mutation(document);
    document.sessions = document.sessions.filter((item) => Date.parse(item.expiresAt) > Date.now()).slice(-5_000);
    document.invitations = document.invitations.slice(-2_000);
    document.usage = document.usage.slice(-20_000);
    document.audit = document.audit.slice(-5_000);
    await atomicWriteFile(storePath(root), `${JSON.stringify(document, null, 2)}\n`);
    return result;
  });
  mutationQueues.set(root, run);
  try {
    return await run;
  } finally {
    if (mutationQueues.get(root) === run) mutationQueues.delete(root);
  }
}

async function readOrCreateServerSecret(root: string): Promise<Buffer> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    const encoded = (await readFile(secretPath(root), "utf8")).trim();
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32) throw new AccountStoreError("server_secret_corrupt");
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  try {
    const handle = await open(secretPath(root), "wx", 0o600);
    try {
      await handle.writeFile(`${key.toString("base64url")}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readOrCreateServerSecret(root);
  }
}

async function encryptSecret(value: string, root: string): Promise<string> {
  const key = await readOrCreateServerSecret(root);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

async function decryptSecret(value: string, root: string): Promise<string> {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new AccountStoreError("secret_corrupt");
  const decipher = createDecipheriv("aes-256-gcm", await readOrCreateServerSecret(root), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function recoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => randomBytes(6).toString("hex").toUpperCase());
}

function audit(document: AccountStoreDocument, action: string, actorId: string | null, targetId: string | null): void {
  document.audit.push({ id: randomUUID(), action, actorId, targetId, occurredAt: new Date().toISOString() });
}

function requirePassword(password: string): void {
  if (!passwordMeetsPolicy(password)) throw new AccountStoreError("password_policy");
}

export async function createCustomerApplication(input: {
  companyName: string;
  contactName: string;
  email: string;
  password: string;
  plan: Plan;
}, root = accountDataRoot()): Promise<AccountRecord> {
  requirePassword(input.password);
  const email = normalizeEmail(input.email);
  const password = await hashPassword(input.password);
  return mutateStore(root, (document) => {
    if (document.accounts.some((account) => account.email === email)) throw new AccountStoreError("email_already_exists");
    const account: AccountRecord = {
      id: randomUUID(),
      role: "customer",
      email,
      name: input.contactName.trim(),
      companyName: input.companyName.trim(),
      password,
      access: "pending_approval",
      billingStatus: "unpaid",
      plan: input.plan,
      monthlyPrice: input.plan === "jpy" ? 1_500 : 9.9,
      currency: input.plan === "jpy" ? "JPY" : "USD",
      totpSecret: null,
      recoveryCodeHashes: [],
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      lastLoginAt: null,
      temporaryPassword: null,
      passwordChangeRequired: false,
    };
    document.accounts.push(account);
    audit(document, "customer.application_created", account.id, account.id);
    return account;
  });
}

export async function bootstrapSuperAdmin(input: {
  name: string;
  email: string;
  password: string;
}, root = accountDataRoot()): Promise<{ account: AccountRecord; totpSecret: string; totpUri: string; recoveryCodes: string[] }> {
  requirePassword(input.password);
  const email = normalizeEmail(input.email);
  const password = await hashPassword(input.password);
  const secret = generateTotpSecret();
  const encryptedSecret = await encryptSecret(secret, root);
  const codes = recoveryCodes();
  return mutateStore(root, (document) => {
    if (document.accounts.some((account) => account.role === "super_admin" || account.role === "operator")) {
      throw new AccountStoreError("admin_already_exists");
    }
    const account: AccountRecord = {
      id: randomUUID(), role: "super_admin", email, name: input.name.trim(), companyName: "비전",
      password, access: "active", billingStatus: "paid", plan: null, monthlyPrice: null, currency: null,
      totpSecret: encryptedSecret, recoveryCodeHashes: codes.map(tokenHash), createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(), approvedBy: null, lastLoginAt: null,
      temporaryPassword: null, passwordChangeRequired: false,
    };
    document.accounts.push(account);
    audit(document, "admin.bootstrap_created", account.id, account.id);
    return { account, totpSecret: secret, totpUri: totpUri({ secret, email }), recoveryCodes: codes };
  });
}

export async function approveCustomer(accountId: string, actorId: string, root = accountDataRoot()): Promise<void> {
  await mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId && item.role === "customer");
    if (!account) throw new AccountStoreError("account_not_found");
    account.approvedAt = new Date().toISOString();
    account.approvedBy = actorId;
    account.access = deriveCustomerAccess(account);
    audit(document, "customer.approved", actorId, accountId);
  });
}

export async function setCustomerBilling(accountId: string, status: BillingStatus, actorId: string, root = accountDataRoot()): Promise<void> {
  await mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId && item.role === "customer");
    if (!account) throw new AccountStoreError("account_not_found");
    account.billingStatus = status;
    account.access = deriveCustomerAccess(account);
    if (status !== "paid") document.sessions = document.sessions.filter((session) => session.accountId !== accountId);
    audit(document, `customer.billing_${status}`, actorId, accountId);
  });
}

export async function setCustomerBlocked(accountId: string, blocked: boolean, actorId: string, root = accountDataRoot()): Promise<void> {
  await mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId && item.role === "customer");
    if (!account) throw new AccountStoreError("account_not_found");
    account.access = blocked ? "blocked" : deriveCustomerAccess({ ...account, access: "active" });
    if (blocked) document.sessions = document.sessions.filter((session) => session.accountId !== accountId);
    audit(document, blocked ? "customer.blocked" : "customer.unblocked", actorId, accountId);
  });
}

export async function setCustomerPlan(accountId: string, plan: Plan, actorId: string, root = accountDataRoot()): Promise<void> {
  await mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId && item.role === "customer");
    if (!account) throw new AccountStoreError("account_not_found");
    account.plan = plan;
    account.monthlyPrice = plan === "jpy" ? 1_500 : 9.9;
    account.currency = plan === "jpy" ? "JPY" : "USD";
    audit(document, `customer.plan_${plan}`, actorId, accountId);
  });
}

export async function createOperatorInvitation(input: {
  name: string;
  email: string;
  invitedBy: string;
}, root = accountDataRoot()): Promise<{ token: string; expiresAt: string }> {
  const email = normalizeEmail(input.email);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  return mutateStore(root, (document) => {
    if (document.accounts.some((account) => account.email === email)) throw new AccountStoreError("email_already_exists");
    document.invitations.push({
      tokenHash: tokenHash(token), name: input.name.trim(), email, invitedBy: input.invitedBy,
      createdAt: new Date().toISOString(), expiresAt, acceptedAt: null,
    });
    audit(document, "operator.invited", input.invitedBy, email);
    return { token, expiresAt };
  });
}

export async function acceptOperatorInvitation(input: { token: string; password: string }, root = accountDataRoot()): Promise<{
  account: AccountRecord; totpSecret: string; totpUri: string; recoveryCodes: string[];
}> {
  requirePassword(input.password);
  const password = await hashPassword(input.password);
  const secret = generateTotpSecret();
  const encryptedSecret = await encryptSecret(secret, root);
  const codes = recoveryCodes();
  return mutateStore(root, (document) => {
    const invitation = document.invitations.find((item) => item.tokenHash === tokenHash(input.token));
    if (!invitation || invitation.acceptedAt || Date.parse(invitation.expiresAt) <= Date.now()) {
      throw new AccountStoreError("invitation_invalid");
    }
    if (document.accounts.some((account) => account.email === invitation.email)) throw new AccountStoreError("email_already_exists");
    invitation.acceptedAt = new Date().toISOString();
    const account: AccountRecord = {
      id: randomUUID(), role: "operator", email: invitation.email, name: invitation.name, companyName: "비전",
      password, access: "active", billingStatus: "paid", plan: null, monthlyPrice: null, currency: null,
      totpSecret: encryptedSecret, recoveryCodeHashes: codes.map(tokenHash), createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(), approvedBy: invitation.invitedBy, lastLoginAt: null,
      temporaryPassword: null, passwordChangeRequired: false,
    };
    document.accounts.push(account);
    audit(document, "operator.accepted", account.id, account.id);
    return { account, totpSecret: secret, totpUri: totpUri({ secret, email: account.email }), recoveryCodes: codes };
  });
}

function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-";
  const entropy = randomBytes(15);
  const suffix = Array.from(entropy, (value) => alphabet[value % alphabet.length]).join("");
  return `T9!${suffix}`;
}

export async function requestCustomerTemporaryPassword(
  emailInput: string,
  root = accountDataRoot(),
): Promise<{ requestId: string; accountId: string; email: string; name: string; temporaryPassword: string; expiresAt: string } | null> {
  const email = normalizeEmail(emailInput);
  const existing = (await readAccountStore(root)).accounts.find((item) => item.email === email && item.role === "customer");
  if (!existing) return null;
  const plainTemporaryPassword = temporaryPassword();
  const password = await hashPassword(plainTemporaryPassword);
  const requestId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1_000).toISOString();
  return mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === existing.id && item.role === "customer");
    if (!account) return null;
    account.temporaryPassword = { requestId, password, createdAt: now.toISOString(), expiresAt };
    audit(document, "customer.password_reset_requested", null, account.id);
    return {
      requestId,
      accountId: account.id,
      email: account.email,
      name: account.name,
      temporaryPassword: plainTemporaryPassword,
      expiresAt,
    };
  });
}

export async function cancelCustomerTemporaryPassword(
  accountId: string,
  requestId: string,
  root = accountDataRoot(),
): Promise<void> {
  await mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId && item.role === "customer");
    if (!account || account.temporaryPassword?.requestId !== requestId) return;
    account.temporaryPassword = null;
    audit(document, "customer.password_reset_delivery_failed", null, account.id);
  });
}

export async function authenticateCustomer(emailInput: string, password: string, root = accountDataRoot()): Promise<AccountRecord> {
  const email = normalizeEmail(emailInput);
  return mutateStore(root, async (document) => {
    const account = document.accounts.find((item) => item.email === email && item.role === "customer");
    if (!account) throw new AccountStoreError("invalid_credentials");
    const permanentValid = await verifyPassword(password, account.password);
    const pending = account.temporaryPassword;
    const temporaryValid = !permanentValid
      && Boolean(pending)
      && Date.parse(pending!.expiresAt) > Date.now()
      && await verifyPassword(password, pending!.password);
    if (!permanentValid && !temporaryValid) throw new AccountStoreError("invalid_credentials");
    account.access = deriveCustomerAccess(account);
    if (account.access !== "active") throw new AccountStoreError(account.access);
    account.temporaryPassword = null;
    if (temporaryValid) account.passwordChangeRequired = true;
    account.lastLoginAt = new Date().toISOString();
    document.usage.push({ id: randomUUID(), accountId: account.id, kind: "login", units: 1, occurredAt: new Date().toISOString() });
    audit(document, temporaryValid ? "customer.temporary_password_used" : "customer.login", account.id, account.id);
    return { ...account, passwordChangeRequired: Boolean(account.passwordChangeRequired) };
  });
}

export async function changeCustomerPassword(
  accountId: string,
  nextPassword: string,
  root = accountDataRoot(),
): Promise<void> {
  requirePassword(nextPassword);
  const password = await hashPassword(nextPassword);
  await mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId && item.role === "customer");
    if (!account || !account.passwordChangeRequired) throw new AccountStoreError("access_denied");
    account.password = password;
    account.passwordChangeRequired = false;
    account.temporaryPassword = null;
    document.sessions = document.sessions.filter((session) => session.accountId !== accountId);
    audit(document, "customer.password_changed", account.id, account.id);
  });
}

export async function authenticateAdmin(input: { email: string; password: string; otp: string }, root = accountDataRoot()): Promise<AccountRecord> {
  const document = await readAccountStore(root);
  const account = document.accounts.find((item) => item.email === normalizeEmail(input.email) && item.role !== "customer");
  if (!account || !(await verifyPassword(input.password, account.password)) || !account.totpSecret) {
    throw new AccountStoreError("invalid_credentials");
  }
  const secret = await decryptSecret(account.totpSecret, root);
  const otpValid = verifyTotp(secret, input.otp);
  const recoveryHash = tokenHash(input.otp.replace(/-/gu, "").toUpperCase());
  const recoveryIndex = account.recoveryCodeHashes.indexOf(recoveryHash);
  if (!otpValid && recoveryIndex < 0) throw new AccountStoreError("invalid_otp");
  await mutateStore(root, (next) => {
    const current = next.accounts.find((item) => item.id === account.id);
    if (!current) throw new AccountStoreError("account_not_found");
    current.lastLoginAt = new Date().toISOString();
    if (!otpValid && recoveryIndex >= 0) current.recoveryCodeHashes.splice(recoveryIndex, 1);
    audit(next, "admin.login", account.id, account.id);
  });
  return account;
}

export async function resetAdminMfa(input: { email: string; password: string }, root = accountDataRoot()): Promise<{
  account: AccountRecord;
  totpSecret: string;
  totpUri: string;
  recoveryCodes: string[];
}> {
  const document = await readAccountStore(root);
  const account = document.accounts.find((item) => item.email === normalizeEmail(input.email) && item.role !== "customer");
  if (!account || !(await verifyPassword(input.password, account.password))) {
    throw new AccountStoreError("invalid_credentials");
  }

  const secret = generateTotpSecret();
  const encryptedSecret = await encryptSecret(secret, root);
  const codes = recoveryCodes();
  return mutateStore(root, (next) => {
    const current = next.accounts.find((item) => item.id === account.id && item.role !== "customer");
    if (!current) throw new AccountStoreError("account_not_found");
    current.totpSecret = encryptedSecret;
    current.recoveryCodeHashes = codes.map(tokenHash);
    next.sessions = next.sessions.filter((session) => session.accountId !== current.id);
    audit(next, "admin.mfa_reset", current.id, current.id);
    return {
      account: current,
      totpSecret: secret,
      totpUri: totpUri({ secret, email: current.email }),
      recoveryCodes: codes,
    };
  });
}

export async function issueSession(accountId: string, kind: SessionKind, ttlSeconds: number, root = accountDataRoot()): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1_000).toISOString();
  return mutateStore(root, (document) => {
    const account = document.accounts.find((item) => item.id === accountId);
    if (!account) throw new AccountStoreError("account_not_found");
    if (kind === "customer" && (account.role !== "customer" || deriveCustomerAccess(account) !== "active")) {
      throw new AccountStoreError("access_denied");
    }
    if (kind === "admin" && account.role === "customer") throw new AccountStoreError("access_denied");
    document.sessions.push({ tokenHash: tokenHash(token), accountId, kind, createdAt: new Date().toISOString(), expiresAt });
    return { token, expiresAt };
  });
}

export async function resolveSession(token: string, kind: SessionKind, root = accountDataRoot()): Promise<{ account: AccountRecord; expiresAt: string } | null> {
  if (!token) return null;
  const document = await readAccountStore(root);
  const session = document.sessions.find((item) => item.tokenHash === tokenHash(token) && item.kind === kind);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const account = document.accounts.find((item) => item.id === session.accountId);
  if (!account) return null;
  if (kind === "customer" && (account.role !== "customer" || deriveCustomerAccess(account) !== "active")) return null;
  if (kind === "admin" && account.role === "customer") return null;
  return {
    account: {
      ...account,
      access: deriveCustomerAccess(account),
      passwordChangeRequired: Boolean(account.passwordChangeRequired),
    },
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(token: string, root = accountDataRoot()): Promise<void> {
  if (!token) return;
  await mutateStore(root, (document) => {
    document.sessions = document.sessions.filter((item) => item.tokenHash !== tokenHash(token));
  });
}

export async function recordUsage(accountId: string, kind: UsageKind, units = 1, root = accountDataRoot()): Promise<void> {
  await mutateStore(root, (document) => {
    if (!document.accounts.some((item) => item.id === accountId)) return;
    document.usage.push({ id: randomUUID(), accountId, kind, units, occurredAt: new Date().toISOString() });
  });
}

export function publicAccount(account: AccountRecord) {
  return {
    id: account.id,
    role: account.role,
    email: account.email,
    name: account.name,
    companyName: account.companyName,
    access: deriveCustomerAccess(account),
    billingStatus: account.billingStatus,
    plan: account.plan,
    monthlyPrice: account.monthlyPrice,
    currency: account.currency,
    createdAt: account.createdAt,
    approvedAt: account.approvedAt,
    lastLoginAt: account.lastLoginAt,
    passwordChangeRequired: Boolean(account.passwordChangeRequired),
  };
}

export async function adminOverview(root = accountDataRoot()) {
  const document = await readAccountStore(root);
  const usageByAccount = new Map<string, Record<UsageKind, number>>();
  for (const item of document.usage) {
    const current = usageByAccount.get(item.accountId) ?? { login: 0, recording: 0, summary: 0, realtime_session: 0, translation: 0 };
    current[item.kind] += item.units;
    usageByAccount.set(item.accountId, current);
  }
  return {
    customers: document.accounts.filter((item) => item.role === "customer").map((account) => ({
      ...publicAccount(account),
      usage: usageByAccount.get(account.id) ?? { login: 0, recording: 0, summary: 0, realtime_session: 0, translation: 0 },
    })),
    operators: document.accounts.filter((item) => item.role !== "customer").map(publicAccount),
    audit: document.audit.slice(-50).reverse(),
  };
}
