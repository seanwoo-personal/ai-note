import { afterEach, describe, expect, it } from "vitest";

import { glossaryPath } from "@/lib/config";
import { accountTenantDataRoot, runWithAccountTenantData } from "@/lib/tenantDataContext";

describe("config", () => {
  afterEach(() => delete process.env.AI_NOTE_GLOSSARY_PATH);

  it("defaults the glossary to the current project and reads an override lazily", () => {
    expect(glossaryPath()).toBe(`${process.cwd()}/glossary.json`);
    process.env.AI_NOTE_GLOSSARY_PATH = "/tmp/ai-note-glossary.json";
    expect(glossaryPath()).toBe("/tmp/ai-note-glossary.json");
  });

  it("keeps authenticated customer glossaries isolated from a legacy global override", () => {
    process.env.AI_NOTE_GLOSSARY_PATH = "/tmp/ai-note-glossary.json";
    const accountId = "181e8f1f-80d5-464d-83c1-e7ad416f90e3";

    const path = runWithAccountTenantData(accountId, () => glossaryPath());

    expect(path).toBe(`${accountTenantDataRoot(accountId)}/glossary.json`);
  });
});
