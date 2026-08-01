import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(process.env.AI_NOTE_REPORTER_TEST_ROOT ?? "test-results/reporter-fail-closed");
const phases = ["setup", "onEnd", "artifact-copy", "manifest"];
const grep = "light, dark, and system preferences survive reload";

async function runCase(name, injectedFailure) {
  const caseRoot = join(root, name);
  const evidenceRoot = join(caseRoot, "playwright-evidence");
  assert.equal(basename(evidenceRoot), "playwright-evidence");
  await rm(caseRoot, { recursive: true, force: true });
  await mkdir(caseRoot, { recursive: true, mode: 0o700 });

  const args = ["scripts/run-e2e.mjs", "--grep", grep];
  if (injectedFailure) args.push("--project", "desktop-1440");
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_EXECUTE_BROWSER_EVIDENCE_DIR: evidenceRoot,
      ...(injectedFailure ? { AI_NOTE_E2E_INJECT_REPORTER_FAILURE: injectedFailure } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const commandExit = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
  });
  const endedAt = new Date().toISOString();
  await writeFile(join(caseRoot, "stdout.log"), stdout, { mode: 0o600 });
  await writeFile(join(caseRoot, "stderr.log"), stderr, { mode: 0o600 });

  const match = stdout.match(/^\[e2e-runner\] termination=(.+)$/mu);
  assert.ok(match, `${name}: missing machine-readable termination record`);
  const termination = JSON.parse(match[1]);
  assert.equal(termination.commandExit, commandExit, `${name}: command exit must be recorded separately`);

  return { name, startedAt, endedAt, commandExit, termination, evidenceRoot };
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true, mode: 0o700 });
const results = [];
for (const phase of phases) {
  const result = await runCase(`failure-${phase}`, phase);
  assert.notEqual(result.commandExit, 0, `${phase}: wrapper command must exit nonzero`);
  assert.notEqual(result.termination.playwrightExit, 0, `${phase}: Playwright process must exit nonzero`);
  assert.notEqual(result.termination.reporterExit, 0, `${phase}: reporter status must be nonzero`);
  assert.equal(result.termination.reporterErrorClassification, phase);
  assert.notEqual(result.termination.wrapperExit, 0, `${phase}: wrapper decision must be nonzero`);
  results.push(result);
}

const success = await runCase("success", null);
assert.equal(success.commandExit, 0, "success: wrapper command must exit zero");
assert.equal(success.termination.playwrightExit, 0, "success: Playwright process must exit zero");
assert.equal(success.termination.reporterExit, 0, "success: reporter status must be zero");
assert.equal(success.termination.reporterErrorClassification, null);
assert.equal(success.termination.wrapperExit, 0, "success: wrapper decision must be zero");
const manifestPath = join(success.evidenceRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.browser.assertionsPassed, true);
assert.equal(manifest.browser.artifacts.screenshots.length, 4);
for (const record of manifest.browser.artifacts.screenshots) {
  assert.ok((await stat(join(success.evidenceRoot, record.path))).isFile(), `missing screenshot ${record.path}`);
}
for (const record of [manifest.browser.artifacts.assertions, manifest.browser.artifacts.console]) {
  assert.ok((await stat(join(success.evidenceRoot, record.path))).isFile(), `missing artifact ${record.path}`);
}
results.push(success);
await writeFile(join(root, "summary.json"), JSON.stringify({ schemaVersion: 1, results }, null, 2), { mode: 0o600 });
console.log(`reporter fail-closed integration: ${phases.length} failures + 1 success passed`);
console.log(`summary=${join(root, "summary.json")}`);
