import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

interface TenantDataContextState {
  dataRoot: string;
}

declare global {
  var __aiNoteTenantDataContext: AsyncLocalStorage<TenantDataContextState> | undefined;
}

function storage(): AsyncLocalStorage<TenantDataContextState> {
  globalThis.__aiNoteTenantDataContext ??= new AsyncLocalStorage<TenantDataContextState>();
  return globalThis.__aiNoteTenantDataContext;
}

export function baseDataRoot(): string {
  return join(process.cwd(), "data");
}

export function accountTenantDataRoot(accountId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(accountId)) {
    throw new Error("invalid_account_tenant");
  }
  const opaqueId = createHash("sha256").update(accountId).digest("hex");
  return join(baseDataRoot(), "tenants", opaqueId);
}

export function activeTenantDataRoot(): string | null {
  return storage().getStore()?.dataRoot ?? null;
}

export function activateAccountTenantData(accountId: string): string {
  const dataRoot = accountTenantDataRoot(accountId);
  storage().enterWith({ dataRoot });
  return dataRoot;
}

export function runWithAccountTenantData<T>(
  accountId: string,
  task: () => T,
): T {
  const dataRoot = accountTenantDataRoot(accountId);
  return storage().run({ dataRoot }, task);
}

export function runWithTenantDataRoot<T>(dataRoot: string, task: () => T): T {
  return storage().run({ dataRoot }, task);
}

export async function listTenantDataRoots(): Promise<string[]> {
  const root = join(baseDataRoot(), "tenants");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name))
      .map((entry) => join(root, entry.name))
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
