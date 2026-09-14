import { E2E_CUSTOMER_ID, installAccountFixture } from "../scripts/e2e-account-fixture.mjs";
import { installFirstRunFixture } from "../scripts/e2e-first-run-fixture.mjs";
import { installManualEditingFixture } from "../scripts/e2e-manual-editing-fixture.mjs";

export default async function globalSetup() {
  await installAccountFixture();
  await installManualEditingFixture({ tenantAccountId: E2E_CUSTOMER_ID });
  await installFirstRunFixture({ tenantAccountId: E2E_CUSTOMER_ID });
}
