import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accountTenantDataRoot,
  activeTenantDataRoot,
  runWithAccountTenantData,
} from "@/lib/tenantDataContext";
import { dataRoot } from "@/lib/paths";

describe("tenant data context", () => {
  const originalCwd = process.cwd();
  let testCwd = "";

  beforeEach(async () => {
    testCwd = await mkdtemp(join(tmpdir(), "ai-note-tenant-context-"));
    process.chdir(testCwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testCwd, { recursive: true, force: true });
  });

  it("keeps the legacy data root outside an authenticated customer request", () => {
    expect(activeTenantDataRoot()).toBeNull();
    expect(dataRoot()).toBe(join(process.cwd(), "data"));
  });

  it("gives different customer accounts non-overlapping opaque data roots", () => {
    const first = accountTenantDataRoot("181e8f1f-80d5-464d-83c1-e7ad416f90e3");
    const second = accountTenantDataRoot("e0fd89e5-1224-4367-9090-ef9e02ba2a67");

    expect(first).not.toBe(second);
    expect(first).toMatch(/\/data\/tenants\/[a-f0-9]{64}$/u);
    expect(second).toMatch(/\/data\/tenants\/[a-f0-9]{64}$/u);
    expect(first).not.toContain("181e8f1f");
  });

  it("preserves the account root across awaits and concurrent requests", async () => {
    const observed = await Promise.all([
      runWithAccountTenantData("181e8f1f-80d5-464d-83c1-e7ad416f90e3", async () => {
        await Promise.resolve();
        return dataRoot();
      }),
      runWithAccountTenantData("e0fd89e5-1224-4367-9090-ef9e02ba2a67", async () => {
        await Promise.resolve();
        return dataRoot();
      }),
    ]);

    expect(observed).toEqual([
      accountTenantDataRoot("181e8f1f-80d5-464d-83c1-e7ad416f90e3"),
      accountTenantDataRoot("e0fd89e5-1224-4367-9090-ef9e02ba2a67"),
    ]);
    expect(activeTenantDataRoot()).toBeNull();
  });

  it("stores the same relative artifact path separately for each customer", async () => {
    const filename = join("meetings", "same-id", "raw.md");
    const writeFor = async (accountId: string, value: string) => (
      runWithAccountTenantData(accountId, async () => {
        const path = join(dataRoot(), filename);
        await mkdir(join(dataRoot(), "meetings", "same-id"), { recursive: true });
        await writeFile(path, value);
        return path;
      })
    );

    const firstPath = await writeFor("181e8f1f-80d5-464d-83c1-e7ad416f90e3", "첫 번째");
    const secondPath = await writeFor("e0fd89e5-1224-4367-9090-ef9e02ba2a67", "두 번째");

    expect(firstPath).not.toBe(secondPath);
    await expect(readFile(firstPath, "utf8")).resolves.toBe("첫 번째");
    await expect(readFile(secondPath, "utf8")).resolves.toBe("두 번째");
  });
});
