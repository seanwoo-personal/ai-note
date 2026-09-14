import { join } from "node:path";

import { activeTenantDataRoot } from "@/lib/tenantDataContext";

// Read lazily so builds never require runtime configuration.
export function glossaryPath(): string {
  const tenantRoot = activeTenantDataRoot();
  if (tenantRoot) return join(tenantRoot, "glossary.json");
  return process.env.AI_NOTE_GLOSSARY_PATH ?? join(process.cwd(), "glossary.json");
}
