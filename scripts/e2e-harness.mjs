import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const E2E_SNAPSHOT_ENTRIES = [
  "src",
  "public",
  "RELEASES.md",
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "next-env.d.ts",
];

export const E2E_OWNERSHIP_MARKER = ".ai-note-e2e-owner.json";

async function assertCanonicalDirectoryChain(path, label) {
  const chain = [];
  let current = path;
  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const component of chain.reverse()) {
    const info = await lstat(component);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`E2E ${label} must use a canonical real path with no symlink ancestors: ${component}`);
    }
  }
}

function assertOwnershipToken(token) {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) {
    throw new Error("E2E runner ownership token is required");
  }
  return token;
}

export async function assertE2eSnapshotOwnership(rawSnapshotRoot, ownershipToken) {
  const root = resolveE2eSnapshotRoot(rawSnapshotRoot);
  const token = assertOwnershipToken(ownershipToken);
  await assertCanonicalDirectoryChain(root, "snapshot root");
  const realRoot = await realpath(root);
  if (realRoot !== root) {
    throw new Error(`E2E snapshot root must use its canonical real path (no symlink ancestors): ${root} -> ${realRoot}`);
  }
  const markerPath = join(root, E2E_OWNERSHIP_MARKER);
  let markerInfo;
  try {
    markerInfo = await lstat(markerPath);
  } catch (error) {
    throw new Error(`E2E runner ownership marker is missing or unreadable: ${markerPath}`, { cause: error });
  }
  if (markerInfo.isSymbolicLink() || !markerInfo.isFile()) {
    throw new Error(`E2E runner ownership marker must be a real regular file: ${markerPath}`);
  }
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    throw new Error(`E2E runner ownership marker is malformed: ${markerPath}`, { cause: error });
  }
  if (marker?.token !== token || Object.keys(marker).length !== 1) {
    throw new Error(`E2E runner ownership marker does not match this runner: ${markerPath}`);
  }
  return root;
}

export function parseE2ePort(raw) {
  if (!/^\d+$/.test(raw ?? "")) throw new Error("AI_NOTE_E2E_PORT is required");
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("AI_NOTE_E2E_PORT is required");
  }
  return port;
}

export async function assertRegularTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(`E2E snapshot refuses symlink input: ${path} -> ${await readlink(path)}`);
  }
  if (!info.isDirectory()) return;
  for (const entry of await readdir(path)) await assertRegularTree(join(path, entry));
}

export async function assertRealDirectory(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`E2E ${label} must be a real directory: ${path}`);
  }
}

export async function resolveE2eNodeModules(startRoot, expectedPlaywrightVersion) {
  if (typeof expectedPlaywrightVersion !== "string" || expectedPlaywrightVersion.length === 0) {
    throw new Error("E2E expected Playwright version is required");
  }
  let current = await realpath(startRoot);
  while (true) {
    const nodeModules = join(current, "node_modules");
    const packagePath = join(nodeModules, "@playwright", "test", "package.json");
    let packageText;
    try {
      packageText = await readFile(packagePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
      continue;
    }

    await assertRealDirectory(nodeModules, "node_modules");
    let installed;
    try {
      installed = JSON.parse(packageText);
    } catch {
      throw new Error(`E2E Playwright package metadata is invalid: ${packagePath}`);
    }
    if (installed?.version !== expectedPlaywrightVersion) {
      throw new Error(
        `E2E Playwright version mismatch: expected ${expectedPlaywrightVersion}, found ${installed?.version ?? "unknown"}`,
      );
    }
    return realpath(nodeModules);
  }
  throw new Error(`E2E node_modules with @playwright/test ${expectedPlaywrightVersion} was not found`);
}

export function buildE2eServerEnv(sourceEnv, syntheticHome, appPort) {
  const result = {};
  for (const name of [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "COMSPEC",
    "CI",
  ]) {
    if (sourceEnv[name] !== undefined) result[name] = sourceEnv[name];
  }
  return {
    ...result,
    HOME: syntheticHome,
    AI_NOTE_DISABLE_WORKER: "1",
    LOCAL_STT_HOST: "127.0.0.1",
    LOCAL_STT_PORT: appPort,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "development",
  };
}

export function buildE2eRunnerEnv(sourceEnv, port, snapshotRoot, ownershipToken) {
  const result = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "COMSPEC",
    "CI",
    "XDG_CACHE_HOME",
    "PLAYWRIGHT_BROWSERS_PATH",
    "AI_EXECUTE_BROWSER_EVIDENCE_DIR",
    "AI_NOTE_GLOBAL_MEETING_EVIDENCE_DIR",
    "AI_NOTE_E2E_REQUIREMENTS",
  ]) {
    if (sourceEnv[name] !== undefined) result[name] = sourceEnv[name];
  }
  return {
    ...result,
    AI_NOTE_E2E_PORT: port,
    AI_NOTE_E2E_SNAPSHOT_ROOT: snapshotRoot,
    AI_NOTE_E2E_OWNERSHIP_TOKEN: assertOwnershipToken(ownershipToken),
  };
}

export function shouldCopyE2eSource(sourceRoot, sourcePath) {
  return resolve(sourcePath) !== resolve(sourceRoot, "src", "instrumentation.ts");
}

export function resolveE2eSnapshotRoot(raw) {
  if (!raw || !isAbsolute(raw) || resolve(raw) !== raw || !basename(raw).startsWith("ai-note-e2e-")) {
    throw new Error("AI_NOTE_E2E_SNAPSHOT_ROOT must be an absolute runner-owned snapshot root");
  }
  return raw;
}

function assertSafeDescendantSegment(segment) {
  if (
    typeof segment !== "string"
    || segment.length === 0
    || segment === "."
    || segment === ".."
    || segment !== basename(segment)
    || segment.includes("/")
    || segment.includes("\\")
    || segment.includes("\0")
  ) {
    throw new Error(`E2E owned descendant refuses unsafe path segment: ${String(segment)}`);
  }
  return segment;
}

/**
 * Resolve a descendant path that MUST live under the canonical, runner-owned
 * `ai-note-e2e-*` snapshot namespace, refusing anything that could escape it. Reuses
 * the exact `resolveE2eSnapshotRoot` contract (absolute + lexically canonical + owned
 * basename), then walks the root ancestry and every named component with `lstat`,
 * rejecting a symlink (or a non-directory ancestor) at ANY level, and finally
 * cross-checks the real path against
 * the real snapshot root so no symlink hop can widen the target. Returns the validated
 * absolute path, or `null` when a component is simply absent (a safe no-op for callers).
 * It never follows a symlink and never returns a path outside the snapshot root.
 */
export async function resolveOwnedE2eDescendant(rawSnapshotRoot, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("E2E owned descendant requires at least one path segment");
  }
  // Validate EVERY segment up front so an unsafe/escaping component is rejected before
  // any filesystem access (and independent of whether earlier components exist yet).
  for (const segment of segments) assertSafeDescendantSegment(segment);
  const root = resolveE2eSnapshotRoot(rawSnapshotRoot);
  await assertCanonicalDirectoryChain(root, "snapshot root");
  const realRoot = await realpath(root);
  if (realRoot !== root) {
    throw new Error(`E2E snapshot root must use its canonical real path (no symlink ancestors): ${root} -> ${realRoot}`);
  }
  let current = root;
  for (let i = 0; i < segments.length; i += 1) {
    current = join(current, segments[i]);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`E2E owned descendant refuses symlink component: ${current} -> ${await readlink(current)}`);
    }
    if (i < segments.length - 1 && !info.isDirectory()) {
      throw new Error(`E2E owned descendant ancestor must be a real directory: ${current}`);
    }
  }
  const realCurrent = await realpath(current);
  if (realCurrent !== join(realRoot, ...segments)) {
    throw new Error(`E2E owned descendant escaped its snapshot root: ${current} -> ${realCurrent}`);
  }
  return current;
}

/**
 * Fail-closed removal of the exact `data/meetings/synthetic-global-<project>` seed the
 * Global Meeting e2e spec writes into the shared, runner-owned snapshot data root.
 * Deletion happens ONLY when (1) an unguessable runner token matches the root's real
 * ownership marker, (2) the path is a canonical, symlink-free descendant of the
 * `ai-note-e2e-*` namespace (see resolveOwnedE2eDescendant), AND (3) the directory's own
 * `status.json` proves this spec's stable identity (`id` + `titleOverride`). An absent
 * seed is a no-op; an unreadable/malformed status, a mismatched identity, or any symlink
 * component throws WITHOUT deleting. It never touches parent trees, baseline fixtures,
 * real meetings, `.env`, or user data.
 */
function inodeIdentity(info) {
  return {
    dev: info.dev,
    ino: info.ino,
    mode: info.mode,
  };
}

function sameInodeIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathChain(path) {
  const chain = [];
  let current = path;
  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain.reverse();
}

async function captureOwnedSnapshotIdentity(snapshotRoot, ownershipToken, validateRunnerName) {
  const root = validateRunnerName
    ? await assertE2eSnapshotOwnership(snapshotRoot, ownershipToken)
    : snapshotRoot;
  await assertCanonicalDirectoryChain(root, "snapshot root");
  if (await realpath(root) !== root) {
    throw new Error(`E2E snapshot root must use its canonical real path: ${root}`);
  }
  const chainPaths = pathChain(root);
  const chain = [];
  for (const path of chainPaths) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`E2E snapshot identity requires a real directory: ${path}`);
    }
    chain.push(inodeIdentity(info));
  }
  const markerPath = join(root, E2E_OWNERSHIP_MARKER);
  const markerInfo = await lstat(markerPath);
  if (markerInfo.isSymbolicLink() || !markerInfo.isFile() || (markerInfo.mode & 0o777) !== 0o600) {
    throw new Error(`E2E runner ownership marker must be a mode 0600 real regular file: ${markerPath}`);
  }
  const markerBytes = await readFile(markerPath);
  let marker;
  try {
    marker = JSON.parse(markerBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`E2E runner ownership marker is malformed: ${markerPath}`, { cause: error });
  }
  if (marker?.token !== assertOwnershipToken(ownershipToken) || Object.keys(marker).length !== 1) {
    throw new Error(`E2E runner ownership marker does not match this runner: ${markerPath}`);
  }
  return {
    chain,
    marker: inodeIdentity(markerInfo),
    markerBytes,
    markerHash: sha256(markerBytes),
  };
}

function sameCapturedSnapshotIdentity(left, right) {
  return left.chain.length === right.chain.length
    && left.chain.every((identity, index) => sameInodeIdentity(identity, right.chain[index]))
    && sameInodeIdentity(left.marker, right.marker)
    && left.markerHash === right.markerHash
    && left.markerBytes.equals(right.markerBytes);
}

export async function removeOwnedE2eSnapshotRoot({ snapshotRoot, ownershipToken, testHooks = {} }) {
  const root = resolveE2eSnapshotRoot(snapshotRoot);
  const captured = await captureOwnedSnapshotIdentity(root, ownershipToken, true);
  await testHooks.afterCapture?.();
  const revalidated = await captureOwnedSnapshotIdentity(root, ownershipToken, true);
  if (!sameCapturedSnapshotIdentity(captured, revalidated)) {
    throw new Error(`refusing to remove E2E snapshot root whose identity changed: ${root}`);
  }
  await testHooks.afterRevalidateBeforeQuarantine?.();

  const quarantineRoot = join(dirname(root), `.ai-note-e2e-quarantine-${basename(root)}-${randomUUID()}`);
  await rename(root, quarantineRoot);
  await testHooks.afterQuarantine?.(quarantineRoot);
  let quarantined;
  try {
    quarantined = await captureOwnedSnapshotIdentity(quarantineRoot, ownershipToken, false);
  } catch (error) {
    await restoreQuarantineWithoutOverwrite(quarantineRoot, root);
    throw new Error(`refusing to remove E2E snapshot root with unreadable quarantine identity: ${quarantineRoot}`, {
      cause: error,
    });
  }
  if (!sameCapturedSnapshotIdentity(captured, quarantined)) {
    await restoreQuarantineWithoutOverwrite(quarantineRoot, root);
    throw new Error(`refusing to remove E2E snapshot root whose quarantine identity changed: ${quarantineRoot}`);
  }
  await rm(quarantineRoot, { recursive: true, force: false });
  return { removed: true, snapshotRoot: root };
}

async function captureOwnedMeetingIdentity({ snapshotRoot, ownershipToken, meetingId, meetingRoot }) {
  const root = await assertE2eSnapshotOwnership(snapshotRoot, ownershipToken);
  const dataRoot = join(root, "data");
  const meetingsRoot = join(dataRoot, "meetings");
  const expectedMeetingRoot = join(meetingsRoot, basename(meetingRoot));
  if (meetingRoot !== expectedMeetingRoot) {
    throw new Error(`E2E meeting identity escaped its owned parent: ${meetingRoot}`);
  }

  const directoryPaths = [root, dataRoot, meetingsRoot, meetingRoot];
  const directories = [];
  for (const path of directoryPaths) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(path) !== path) {
      throw new Error(`E2E meeting identity requires a canonical real directory: ${path}`);
    }
    directories.push(inodeIdentity(info));
  }

  const markerPath = join(root, E2E_OWNERSHIP_MARKER);
  const markerInfo = await lstat(markerPath);
  if (markerInfo.isSymbolicLink() || !markerInfo.isFile() || (markerInfo.mode & 0o777) !== 0o600) {
    throw new Error(`E2E runner ownership marker must be a mode 0600 real regular file: ${markerPath}`);
  }
  const markerBytes = await readFile(markerPath);

  const statusPath = join(meetingRoot, "status.json");
  const statusInfo = await lstat(statusPath);
  if (statusInfo.isSymbolicLink() || !statusInfo.isFile() || statusInfo.nlink !== 1) {
    throw new Error(`refusing to remove Global Meeting seed: status.json must be a real regular file with a single link: ${statusPath}`);
  }
  const statusBytes = await readFile(statusPath);
  let status;
  try {
    status = JSON.parse(statusBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`refusing to remove Global Meeting seed with malformed status.json: ${meetingRoot}`, { cause: error });
  }
  if (status?.id !== meetingId) {
    throw new Error(`refusing to remove unrecognized meeting directory: ${meetingRoot}`);
  }

  return {
    root,
    directoryPaths,
    directories,
    marker: inodeIdentity(markerInfo),
    markerBytes,
    markerHash: sha256(markerBytes),
    status: { ...inodeIdentity(statusInfo), nlink: statusInfo.nlink },
    statusBytes,
    statusHash: sha256(statusBytes),
  };
}

function sameCapturedMeetingIdentity(left, right) {
  return left.directoryPaths.length === right.directoryPaths.length
    && left.directories.every((identity, index) => sameInodeIdentity(identity, right.directories[index]))
    && sameInodeIdentity(left.marker, right.marker)
    && left.markerHash === right.markerHash
    && left.markerBytes.equals(right.markerBytes)
    && sameInodeIdentity(left.status, right.status)
    && left.status.nlink === right.status.nlink
    && left.statusHash === right.statusHash
    && left.statusBytes.equals(right.statusBytes);
}

async function restoreQuarantineWithoutOverwrite(quarantineRoot, meetingRoot) {
  try {
    await lstat(meetingRoot);
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rename(quarantineRoot, meetingRoot);
  return true;
}

export async function removeOwnedE2eMeetingSeed({
  snapshotRoot,
  ownershipToken,
  project,
  expectedTitleOverride,
  testHooks = {},
}) {
  if (typeof project !== "string" || project.length === 0) {
    throw new Error("E2E owned meeting seed requires a project name");
  }
  await assertE2eSnapshotOwnership(snapshotRoot, ownershipToken);
  const meetingId = `synthetic-global-${project}`;
  const segments = ["data", "meetings", meetingId];
  const meetingRoot = await resolveOwnedE2eDescendant(snapshotRoot, segments);
  if (meetingRoot === null) return { removed: false, reason: "absent" };
  const captured = await captureOwnedMeetingIdentity({ snapshotRoot, ownershipToken, meetingId, meetingRoot });
  const status = JSON.parse(captured.statusBytes.toString("utf8"));
  if (status?.id !== meetingId || status?.titleOverride !== expectedTitleOverride) {
    throw new Error(`refusing to remove unrecognized meeting directory: ${meetingRoot}`);
  }
  await testHooks.afterCapture?.();

  const revalidated = await captureOwnedMeetingIdentity({ snapshotRoot, ownershipToken, meetingId, meetingRoot });
  if (!sameCapturedMeetingIdentity(captured, revalidated)) {
    throw new Error(`refusing to remove Global Meeting seed whose identity changed before delete: ${meetingRoot}`);
  }
  await testHooks.afterRevalidateBeforeQuarantine?.();

  // Node does not expose directory-handle-relative recursive deletion. Atomically move
  // the verified leaf to an unguessable same-parent quarantine first. A replacement at
  // the public meeting path after this commit point is no longer the path we delete.
  const quarantineRoot = join(dirname(meetingRoot), `.ai-note-e2e-quarantine-${meetingId}-${randomUUID()}`);
  await rename(meetingRoot, quarantineRoot);
  await testHooks.afterQuarantine?.(quarantineRoot);
  let quarantined;
  try {
    quarantined = await captureOwnedMeetingIdentity({
      snapshotRoot,
      ownershipToken,
      meetingId,
      meetingRoot: quarantineRoot,
    });
  } catch (error) {
    await restoreQuarantineWithoutOverwrite(quarantineRoot, meetingRoot);
    throw new Error(`refusing to remove Global Meeting seed whose quarantine identity is unreadable: ${quarantineRoot}`, {
      cause: error,
    });
  }
  if (!sameCapturedMeetingIdentity(captured, quarantined)) {
    await restoreQuarantineWithoutOverwrite(quarantineRoot, meetingRoot);
    throw new Error(`refusing to remove Global Meeting seed whose quarantine identity changed: ${quarantineRoot}`);
  }
  await rm(quarantineRoot, { recursive: true, force: false });
  return { removed: true, meetingRoot };
}
