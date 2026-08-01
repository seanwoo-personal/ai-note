import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  buildE2eRunnerEnv,
  E2E_OWNERSHIP_MARKER,
  removeOwnedE2eSnapshotRoot,
  resolveE2eNodeModules,
} from "./e2e-harness.mjs";

function allocateLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("failed to allocate an E2E port")));
        return;
      }
      probe.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nodeModules = await resolveE2eNodeModules(process.cwd(), packageJson.devDependencies?.["@playwright/test"]);
const cli = join(nodeModules, "@playwright", "test", "cli.js");
const port = await allocateLoopbackPort();
const snapshotRoot = await realpath(await mkdtemp(join(tmpdir(), "ai-note-e2e-")));
const ownershipToken = randomUUID();
const reporterStatusPath = join(snapshotRoot, ".e2e-reporter-status.json");
const injectedReporterFailure = process.env.AI_NOTE_E2E_INJECT_REPORTER_FAILURE;
const allowedReporterFailures = new Set(["setup", "onEnd", "artifact-copy", "manifest"]);
if (injectedReporterFailure !== undefined && !allowedReporterFailures.has(injectedReporterFailure)) {
  throw new Error(`unsupported E2E reporter failure injection: ${injectedReporterFailure}`);
}
await writeFile(
  join(snapshotRoot, E2E_OWNERSHIP_MARKER),
  JSON.stringify({ token: ownershipToken }),
  { encoding: "utf8", flag: "wx", mode: 0o600 },
);
const childEnv = {
  ...buildE2eRunnerEnv(process.env, String(port), snapshotRoot, ownershipToken),
  AI_NOTE_E2E_REPORTER_STATUS_PATH: reporterStatusPath,
  ...(injectedReporterFailure ? { AI_NOTE_E2E_INJECT_REPORTER_FAILURE: injectedReporterFailure } : {}),
};
const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: childEnv,
});

let requestedExitCode = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    requestedExitCode = signal === "SIGINT" ? 130 : 143;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}

const childResult = await new Promise((resolveChild) => {
  let settled = false;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    resolveChild(result);
  };
  child.once("error", (error) => {
    console.error(error);
    settle({ code: 1 });
  });
  child.once("exit", (code, signal) => {
    settle({ code: signal ? 1 : (code ?? 1) });
  });
});

let reporterExitCode = 1;
let reporterErrorClassification = "missing-status";
try {
  const reporterStatus = JSON.parse(await readFile(reporterStatusPath, "utf8"));
  if (
    reporterStatus?.schemaVersion === 1
    && reporterStatus?.phase === "completed"
    && reporterStatus?.status === "passed"
  ) {
    reporterExitCode = 0;
    reporterErrorClassification = null;
  } else {
    reporterErrorClassification = reporterStatus?.reporterErrorClassification ?? "incomplete-status";
    console.error(`[evidence-reporter] fail-closed status: ${JSON.stringify(reporterStatus)}`);
  }
} catch (error) {
  console.error("[evidence-reporter] missing or unreadable completion status", error);
}
console.log(`[evidence-reporter] reporter_exit=${reporterExitCode}`);
let cleanupExitCode = 0;
try {
  await removeOwnedE2eSnapshotRoot({ snapshotRoot, ownershipToken });
} catch (error) {
  cleanupExitCode = 1;
  console.error("[e2e-runner] failed to remove owned snapshot root", error);
}
const wrapperExitCode = requestedExitCode
  ?? (childResult.code !== 0 ? childResult.code : (reporterExitCode !== 0 ? reporterExitCode : cleanupExitCode));
console.log(`[e2e-runner] termination=${JSON.stringify({
  commandExit: wrapperExitCode,
  playwrightExit: childResult.code,
  reporterExit: reporterExitCode,
  reporterErrorClassification,
  cleanupExit: cleanupExitCode,
  wrapperExit: wrapperExitCode,
})}`);
process.exitCode = wrapperExitCode;
