import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import {
  REQUIRED_SYNTHETIC_VIEWPORTS,
  collectRequirementCoverage,
  validateEvidenceAttachments,
  type TestAttachmentCoverage,
} from "./evidence-contract";

interface ArtifactRecord {
  path: string;
  sha256: string;
  bytes: number;
}

interface ScreenshotRecord extends ArtifactRecord {
  viewport: string;
}

type ReporterErrorClassification = "setup" | "onEnd" | "artifact-copy" | "manifest";

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function bytesForAttachment(attachment: TestResult["attachments"][number]): Buffer | null {
  if (attachment.body) return attachment.body;
  if (attachment.path) return readFileSync(attachment.path);
  return null;
}

function parseAttachmentJson(attachment: TestResult["attachments"][number]): unknown {
  const body = bytesForAttachment(attachment);
  if (!body) return null;
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function prepareEvidenceRoot(path: string, runnerOwned: boolean): void {
  const expectedName = runnerOwned ? "playwright-evidence" : "evidence";
  if (basename(path) !== expectedName) {
    throw new Error(`refusing unsafe Playwright evidence root: ${path}`);
  }
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Playwright evidence root must be a real directory: ${path}`);
    }
    for (const entry of readdirSync(path)) rmSync(join(path, entry), { recursive: true, force: true });
  } else {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  chmodSync(path, 0o700);
  mkdirSync(join(path, "artifacts"), { mode: 0o700 });
}

export default class EvidenceReporter implements Reporter {
  private readonly runnerOwned = process.env.AI_EXECUTE_BROWSER_EVIDENCE_DIR !== undefined;
  private readonly evidenceRoot = resolve(
    process.env.AI_EXECUTE_BROWSER_EVIDENCE_DIR ?? "test-results/evidence",
  );
  private readonly reporterStatusPath = (() => {
    const raw = process.env.AI_NOTE_E2E_REPORTER_STATUS_PATH;
    const snapshotRoot = process.env.AI_NOTE_E2E_SNAPSHOT_ROOT;
    if (!raw || !snapshotRoot) throw new Error("E2E reporter completion status path is required");
    const path = resolve(raw);
    if (dirname(path) !== resolve(snapshotRoot) || basename(path) !== ".e2e-reporter-status.json") {
      throw new Error(`unsafe E2E reporter completion status path: ${path}`);
    }
    return path;
  })();
  private readonly injectedFailure = process.env.AI_NOTE_E2E_INJECT_REPORTER_FAILURE;
  private reporterErrorClassification: ReporterErrorClassification | null = null;
  private readonly screenshots: Array<{
    project: string;
    name: string;
    body: Buffer;
  }> = [];
  private readonly attachmentCoverage: TestAttachmentCoverage[] = [];
  private readonly consoleErrors: string[] = [];
  private readonly expectedNetworkConsoleErrors: string[] = [];
  private readonly externalRequests: string[] = [];
  private readonly tests: Array<{ project: string; title: string; status: string; errors: string[] }> = [];
  private suiteTests: TestCase[] = [];

  onBegin(_config: FullConfig, suite: Suite): void {
    this.runReporterPhase("setup", () => {
      this.suiteTests = suite.allTests();
      prepareEvidenceRoot(this.evidenceRoot, this.runnerOwned);
      if (this.injectedFailure === "setup") throw new Error("injected evidence reporter setup failure");
      writeFileSync(this.reporterStatusPath, JSON.stringify({
        schemaVersion: 1,
        phase: "begun",
        status: "pending",
      }), { flag: "wx", mode: 0o600 });
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "unknown";
    const title = test.titlePath().join(" › ");
    const testId = `${project}:${this.tests.length + 1}:${title}`;
    this.tests.push({
      project,
      title,
      status: result.status,
      errors: result.errors.map((error) => error.message ?? String(error)),
    });

    let screenshotCount = 0;
    let consoleCount = 0;
    let networkCount = 0;
    for (const attachment of result.attachments) {
      if (
        attachment.name === "browser-screenshot"
        || attachment.name.startsWith("browser-screenshot:")
      ) {
        const body = bytesForAttachment(attachment);
        if (body) screenshotCount += 1;
        if (body && result.status === "passed") {
          this.screenshots.push({ project, name: attachment.name, body });
        }
      }
      if (attachment.name === "browser-console") {
        const parsed = parseAttachmentJson(attachment) as {
          errors?: unknown;
          uncaughtOrUnexpectedErrors?: unknown;
          expectedNetworkFailureErrors?: unknown;
        } | null;
        const unexpected = Array.isArray(parsed?.uncaughtOrUnexpectedErrors)
          ? parsed.uncaughtOrUnexpectedErrors
          : parsed?.errors;
        if (Array.isArray(unexpected)) {
          consoleCount += 1;
          this.consoleErrors.push(...unexpected.filter((item): item is string => typeof item === "string"));
          if (Array.isArray(parsed?.expectedNetworkFailureErrors)) {
            this.expectedNetworkConsoleErrors.push(
              ...parsed.expectedNetworkFailureErrors.filter((item): item is string => typeof item === "string"),
            );
          }
        }
      }
      if (attachment.name === "browser-network") {
        const parsed = parseAttachmentJson(attachment) as { externalRequests?: unknown } | null;
        if (Array.isArray(parsed?.externalRequests)) {
          networkCount += 1;
          this.externalRequests.push(
            ...parsed.externalRequests.filter((item): item is string => typeof item === "string"),
          );
        }
      }
    }
    this.attachmentCoverage.push({
      id: testId,
      viewport: project,
      screenshotCount,
      consoleCount,
      networkCount,
    });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] }> {
    if (this.reporterErrorClassification) return { status: "failed" };
    try {
      return this.runReporterPhase("onEnd", () => this.finish(result));
    } catch {
      // Playwright intentionally isolates reporter exceptions. Returning a failed
      // FullResult override is what makes the Playwright child itself fail closed.
      return { status: "failed" };
    }
  }

  private finish(result: FullResult): { status?: FullResult["status"] } {
    if (this.injectedFailure === "onEnd") throw new Error("injected evidence reporter onEnd failure");
    const artifactsRoot = join(this.evidenceRoot, "artifacts");
    const screenshotRecords: ScreenshotRecord[] = [];
    const screenshotIndexes = new Map<string, number>();
    if (this.injectedFailure === "artifact-copy") {
      this.runReporterPhase("artifact-copy", () => {
        throw new Error("injected evidence reporter artifact-copy failure");
      });
    }
    for (const screenshot of this.screenshots) {
      const index = (screenshotIndexes.get(screenshot.project) ?? 0) + 1;
      screenshotIndexes.set(screenshot.project, index);
      const milestone = screenshot.name.split(":", 2)[1] ?? "success";
      const path = join(
        artifactsRoot,
        `${safeName(screenshot.project)}-${String(index).padStart(2, "0")}-${safeName(milestone)}.png`,
      );
      writeFileSync(path, screenshot.body, { mode: 0o600 });
      screenshotRecords.push({ viewport: screenshot.project, ...this.record(path) });
    }

    const attachmentValidation = validateEvidenceAttachments({
      requiredViewports: REQUIRED_SYNTHETIC_VIEWPORTS,
      tests: this.attachmentCoverage,
    });
    const requirementCoverage = collectRequirementCoverage(this.suiteTests);
    const passed = result.status === "passed"
      && attachmentValidation.complete
      && requirementCoverage.invalidAnnotations.length === 0
      && this.consoleErrors.length === 0
      && this.externalRequests.length === 0;
    const assertionsPath = join(artifactsRoot, "assertions.json");
    const consolePath = join(artifactsRoot, "console.json");
    writeFileSync(
      assertionsPath,
      JSON.stringify({
        passed,
        expectedProjects: REQUIRED_SYNTHETIC_VIEWPORTS,
        attachmentValidation,
        invalidRequirementAnnotations: requirementCoverage.invalidAnnotations,
        noConsoleErrors: this.consoleErrors.length === 0,
        noExternalNetwork: this.externalRequests.length === 0,
        externalRequests: this.externalRequests,
        tests: this.tests,
      }, null, 2),
      { mode: 0o600 },
    );
    writeFileSync(
      consolePath,
      JSON.stringify({
        uncaughtOrUnexpectedErrors: this.consoleErrors,
        expectedNetworkFailureErrors: this.expectedNetworkConsoleErrors,
      }, null, 2),
      { mode: 0o600 },
    );

    const manifest = {
      schemaVersion: 1,
      coveredRequirements: requirementCoverage.coveredRequirements,
      browser: {
        backend: "playwright",
        fixture: "synthetic",
        fixtureId: "ai-note-synthetic-library-v1",
        fixtureRoot: "artifacts",
        viewports: REQUIRED_SYNTHETIC_VIEWPORTS,
        assertionsPassed: passed,
        usedRealUserData: false,
        forbiddenRootAccessed: false,
        externalNetworkAccessed: this.externalRequests.length > 0,
        artifacts: {
          screenshots: screenshotRecords,
          assertions: this.record(assertionsPath),
          console: { ...this.record(consolePath), errorCount: this.consoleErrors.length },
        },
      },
    };
    const manifestPath = join(this.evidenceRoot, "manifest.json");
    mkdirSync(dirname(manifestPath), { recursive: true, mode: 0o700 });
    if (this.injectedFailure === "manifest") {
      this.runReporterPhase("manifest", () => {
        throw new Error("injected evidence reporter manifest failure");
      });
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    writeFileSync(this.reporterStatusPath, JSON.stringify({
      schemaVersion: 1,
      phase: "completed",
      status: passed ? "passed" : "failed",
      playwrightStatus: result.status,
      manifest: this.record(manifestPath),
    }), { mode: 0o600 });
    return passed ? {} : { status: "failed" };
  }

  private runReporterPhase<T>(phase: ReporterErrorClassification, operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      this.reporterErrorClassification ??= phase;
      process.exitCode = 1;
      const normalized = error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "Error", message: String(error) };
      try {
        writeFileSync(this.reporterStatusPath, JSON.stringify({
          schemaVersion: 1,
          phase: "failed",
          status: "failed",
          reporterErrorClassification: this.reporterErrorClassification,
          reporterError: normalized,
        }), { mode: 0o600 });
      } catch (statusError) {
        console.error("[evidence-reporter] failed to persist reporter failure status", statusError);
      }
      console.error(`[evidence-reporter] reporter_error=${JSON.stringify({
        classification: this.reporterErrorClassification,
        ...normalized,
      })}`);
      throw error;
    }
  }

  private record(path: string): ArtifactRecord {
    const body = readFileSync(path);
    return {
      path: path.slice(this.evidenceRoot.length + 1).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.byteLength,
    };
  }
}
