import { link, mkdir, mkdtemp, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  E2E_SNAPSHOT_ENTRIES,
  E2E_OWNERSHIP_MARKER,
  assertRealDirectory,
  assertRegularTree,
  buildE2eRunnerEnv,
  buildE2eServerEnv,
  parseE2ePort,
  removeOwnedE2eMeetingSeed,
  removeOwnedE2eSnapshotRoot,
  resolveE2eSnapshotRoot,
  resolveE2eNodeModules,
  resolveOwnedE2eDescendant,
  shouldCopyE2eSource,
} from "../e2e-harness.mjs";

const roots = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ai-note-e2e-harness-test-")));
  roots.push(root);
  return root;
}

describe("E2E harness isolation", () => {
  it("rejects symlinks in product source copied into the synthetic snapshot", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "outside.txt"), "private");
    await symlink(join(root, "outside.txt"), join(root, "src", "leak.txt"));

    await expect(assertRegularTree(join(root, "src"))).rejects.toThrow("refuses symlink input");
  });

  it("accepts a real node_modules root without traversing normal nested bin symlinks", async () => {
    const root = await tempRoot();
    const nodeModules = join(root, "node_modules");
    await mkdir(join(nodeModules, ".bin"), { recursive: true });
    await writeFile(join(nodeModules, "tool.js"), "");
    await symlink(join(nodeModules, "tool.js"), join(nodeModules, ".bin", "tool"));

    await expect(assertRealDirectory(nodeModules, "node_modules")).resolves.toBeUndefined();
  });

  it("rejects a symlinked node_modules root", async () => {
    const root = await tempRoot();
    const realModules = join(root, "real-modules");
    await mkdir(realModules);
    await symlink(realModules, join(root, "node_modules"));

    await expect(assertRealDirectory(join(root, "node_modules"), "node_modules")).rejects.toThrow(
      "must be a real directory",
    );
  });

  it("passes only the minimum environment and relocates HOME into the snapshot", () => {
    expect(buildE2eServerEnv({
      PATH: "/bin",
      HOME: "/Users/example",
      TMPDIR: "/tmp",
      LANG: "ko_KR.UTF-8",
      ANTHROPIC_API_KEY: "secret",
      OPENAI_API_KEY: "secret",
      LOCAL_STT_GLOSSARY: "/private/glossary.json",
    }, "/tmp/synthetic-home", "43210")).toEqual({
      PATH: "/bin",
      TMPDIR: "/tmp",
      LANG: "ko_KR.UTF-8",
      HOME: "/tmp/synthetic-home",
      AI_NOTE_DISABLE_WORKER: "1",
      LOCAL_STT_HOST: "127.0.0.1",
      LOCAL_STT_PORT: "43210",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "development",
    });
  });

  it("keeps the browser runner inputs but strips unrelated credentials", () => {
    expect(buildE2eRunnerEnv({
      PATH: "/bin",
      HOME: "/Users/example",
      CI: "1",
      AI_EXECUTE_BROWSER_EVIDENCE_DIR: "/tmp/playwright-evidence",
      AI_NOTE_E2E_REQUIREMENTS: "R1,R2",
      ANTHROPIC_API_KEY: "secret",
      OPENAI_API_KEY: "secret",
    }, "43210", "/tmp/ai-note-e2e-owned", "0123456789abcdef")).toEqual({
      PATH: "/bin",
      HOME: "/Users/example",
      CI: "1",
      AI_EXECUTE_BROWSER_EVIDENCE_DIR: "/tmp/playwright-evidence",
      AI_NOTE_E2E_REQUIREMENTS: "R1,R2",
      AI_NOTE_E2E_PORT: "43210",
      AI_NOTE_E2E_SNAPSHOT_ROOT: "/tmp/ai-note-e2e-owned",
      AI_NOTE_E2E_OWNERSHIP_TOKEN: "0123456789abcdef",
    });
  });

  it("omits only the disabled worker entrypoint from the product snapshot", () => {
    const sourceRoot = "/repo";
    expect(shouldCopyE2eSource(sourceRoot, "/repo/src/app/page.tsx")).toBe(true);
    expect(shouldCopyE2eSource(sourceRoot, "/repo/src/instrumentation.ts")).toBe(false);
  });

  it("copies only source, public assets, and build metadata into the snapshot", () => {
    expect(E2E_SNAPSHOT_ENTRIES).toEqual([
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
    ]);
    expect(E2E_SNAPSHOT_ENTRIES).not.toEqual(expect.arrayContaining([
      "data",
      "glossary.json",
      ".env.local",
      ".git",
    ]));
  });

  it("accepts only unprivileged TCP ports", () => {
    expect(parseE2ePort("3000")).toBe(3000);
    expect(() => parseE2ePort("1023")).toThrow("AI_NOTE_E2E_PORT is required");
    expect(() => parseE2ePort("3000junk")).toThrow("AI_NOTE_E2E_PORT is required");
  });

  it("accepts only an absolute runner-owned snapshot directory name", () => {
    expect(resolveE2eSnapshotRoot("/tmp/ai-note-e2e-owned")).toBe("/tmp/ai-note-e2e-owned");
    expect(() => resolveE2eSnapshotRoot("ai-note-e2e-relative")).toThrow("snapshot root");
    expect(() => resolveE2eSnapshotRoot("/tmp/unrelated")).toThrow("snapshot root");
  });

  it("resolves exact Playwright dependencies from the parent repository for nested execute worktrees", async () => {
    const root = await tempRoot();
    const nestedWorktree = join(root, ".ai-execute", "worktrees", "plan", "run", "phase-1");
    const nodeModules = join(root, "node_modules");
    await mkdir(join(nodeModules, "@playwright", "test"), { recursive: true });
    await mkdir(nestedWorktree, { recursive: true });
    await writeFile(
      join(nodeModules, "@playwright", "test", "package.json"),
      JSON.stringify({ version: "1.61.1" }),
    );

    await expect(resolveE2eNodeModules(nestedWorktree, "1.61.1")).resolves.toBe(
      await realpath(nodeModules),
    );
  });

  it("fails closed when the nearest Playwright dependency version does not match", async () => {
    const root = await tempRoot();
    const nestedWorktree = join(root, ".ai-execute", "worktrees", "phase-1");
    const nodeModules = join(root, "node_modules");
    await mkdir(join(nodeModules, "@playwright", "test"), { recursive: true });
    await mkdir(nestedWorktree, { recursive: true });
    await writeFile(
      join(nodeModules, "@playwright", "test", "package.json"),
      JSON.stringify({ version: "1.60.0" }),
    );

    await expect(resolveE2eNodeModules(nestedWorktree, "1.61.1")).rejects.toThrow(
      "version mismatch",
    );
  });

  it("does not accept a symlinked parent node_modules dependency root", async () => {
    const root = await tempRoot();
    const nestedWorktree = join(root, ".ai-execute", "worktrees", "phase-1");
    const realModules = join(root, "real-modules");
    await mkdir(join(realModules, "@playwright", "test"), { recursive: true });
    await mkdir(nestedWorktree, { recursive: true });
    await writeFile(
      join(realModules, "@playwright", "test", "package.json"),
      JSON.stringify({ version: "1.61.1" }),
    );
    await symlink(realModules, join(root, "node_modules"));

    await expect(resolveE2eNodeModules(nestedWorktree, "1.61.1")).rejects.toThrow(
      "must be a real directory",
    );
  });
});

// Canonical, symlink-fenced containment for the runner-owned Global Meeting seed the
// e2e spec writes into the shared snapshot data root (task t_3c3f0474 #2). These
// exercise the SHARED helper the spec delegates to, so both the path contract and the
// seed-identity contract are proven here rather than duplicated (divergently) in the spec.
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

describe("E2E owned snapshot-descendant containment", () => {
  const OWNER_TITLE = "확인된 글로벌 미팅 이름";
  const OWNER_ID = "synthetic-global-mobile-390";
  const OWNER_TOKEN = "0123456789abcdef";
  const SEED_SEGMENTS = ["data", "meetings", OWNER_ID];

  async function markOwned(root) {
    await writeFile(join(root, E2E_OWNERSHIP_MARKER), JSON.stringify({ token: OWNER_TOKEN }), { mode: 0o600 });
  }

  async function seedMeeting(statusText, owned = true) {
    const root = await tempRoot();
    if (owned) await markOwned(root);
    const meetingRoot = join(root, ...SEED_SEGMENTS);
    await mkdir(meetingRoot, { recursive: true });
    if (statusText !== null) await writeFile(join(meetingRoot, "status.json"), statusText);
    return { root, meetingRoot };
  }

  it("rejects an arbitrary absolute NON-runner root without touching the filesystem", async () => {
    await expect(resolveOwnedE2eDescendant("/tmp/unrelated", SEED_SEGMENTS)).rejects.toThrow("snapshot root");
  });

  it("rejects a noncanonical / path-escaping snapshot root", async () => {
    await expect(resolveOwnedE2eDescendant("/tmp/ai-note-e2e-x/../ai-note-e2e-y", SEED_SEGMENTS))
      .rejects.toThrow("snapshot root");
  });

  it("rejects an unsafe (path-escaping) descendant segment", async () => {
    const root = await tempRoot();
    await expect(resolveOwnedE2eDescendant(root, ["data", "..", "escape"]))
      .rejects.toThrow("unsafe path segment");
  });

  it("rejects a symlinked ANCESTOR component (data) and never resolves through it", async () => {
    const root = await tempRoot();
    const target = join(root, "real-data");
    await mkdir(join(target, "meetings", OWNER_ID), { recursive: true });
    await symlink(target, join(root, "data"));
    await expect(resolveOwnedE2eDescendant(root, SEED_SEGMENTS)).rejects.toThrow("symlink component");
    expect(await exists(join(target, "meetings", OWNER_ID))).toBe(true);
  });

  it("rejects a runner-looking snapshot root reached through a symlinked parent", async () => {
    const outer = await tempRoot();
    const realParent = join(outer, "real-parent");
    const linkedParent = join(outer, "linked-parent");
    const realRoot = join(realParent, "ai-note-e2e-forged");
    await mkdir(join(realRoot, ...SEED_SEGMENTS), { recursive: true });
    await symlink(realParent, linkedParent);
    const linkedRoot = join(linkedParent, "ai-note-e2e-forged");

    await expect(resolveOwnedE2eDescendant(linkedRoot, SEED_SEGMENTS)).rejects.toThrow("canonical real path");
    expect(await exists(join(realRoot, ...SEED_SEGMENTS))).toBe(true);
  });

  it("rejects a symlinked LEAF component", async () => {
    const root = await tempRoot();
    const target = join(root, "real-leaf");
    await mkdir(target, { recursive: true });
    await mkdir(join(root, "data", "meetings"), { recursive: true });
    await symlink(target, join(root, ...SEED_SEGMENTS));
    await expect(resolveOwnedE2eDescendant(root, SEED_SEGMENTS)).rejects.toThrow("symlink component");
    expect(await exists(target)).toBe(true);
  });

  it("resolves to null (no-op) when the owned seed is simply absent", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "data", "meetings"), { recursive: true });
    await expect(resolveOwnedE2eDescendant(root, SEED_SEGMENTS)).resolves.toBeNull();
  });

  it("resolves the exact canonical descendant for a real directory tree", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    await expect(resolveOwnedE2eDescendant(root, SEED_SEGMENTS)).resolves.toBe(meetingRoot);
  });

  it("removes ONLY the exact owned seed whose status proves this spec's identity", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).resolves.toMatchObject({ removed: true });
    expect(await exists(meetingRoot)).toBe(false);
  });

  it("fails closed when status.json is already hard-linked outside the meeting before capture", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const statusPath = join(meetingRoot, "status.json");
    const externalTarget = join(root, "external-hardlinked-status.json");
    await link(statusPath, externalTarget);

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow(/status\.json.*single link/);
    expect(await exists(meetingRoot)).toBe(true);
    expect(await exists(statusPath)).toBe(true);
    expect(await exists(externalTarget)).toBe(true);
  });

  it("fails closed when status.json gains a hard link between capture and revalidation", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const statusPath = join(meetingRoot, "status.json");
    const externalTarget = join(root, "capture-race-hardlinked-status.json");

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
      testHooks: {
        afterCapture: async () => { await link(statusPath, externalTarget); },
      },
    })).rejects.toThrow(/status\.json.*single link|identity changed/);
    expect(await exists(meetingRoot)).toBe(true);
    expect(await exists(statusPath)).toBe(true);
    expect(await exists(externalTarget)).toBe(true);
  });

  it("fails closed when status.json gains a hard link immediately before quarantine", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const statusPath = join(meetingRoot, "status.json");
    const externalTarget = join(root, "quarantine-race-hardlinked-status.json");

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
      testHooks: {
        afterRevalidateBeforeQuarantine: async () => { await link(statusPath, externalTarget); },
      },
    })).rejects.toThrow(/status\.json.*single link|quarantine identity|identity changed/);
    expect(await exists(meetingRoot)).toBe(true);
    expect(await exists(statusPath)).toBe(true);
    expect(await exists(externalTarget)).toBe(true);
  });

  it("restores the meeting when quarantined status.json gains a hard link before post-quarantine validation", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const externalTarget = join(root, "post-quarantine-hardlinked-status.json");

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
      testHooks: {
        afterQuarantine: async (quarantineRoot) => {
          await link(join(quarantineRoot, "status.json"), externalTarget);
        },
      },
    })).rejects.toThrow(/status\.json.*single link|quarantine identity/);
    expect(await exists(meetingRoot)).toBe(true);
    expect(await exists(join(meetingRoot, "status.json"))).toBe(true);
    expect(await exists(externalTarget)).toBe(true);
  });

  it("fails closed when the snapshot root is replaced after identity capture", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const displacedRoot = `${root}-captured-original`;
    roots.push(displacedRoot);

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
      testHooks: {
        afterCapture: async () => {
          await rename(root, displacedRoot);
          await mkdir(join(root, ...SEED_SEGMENTS), { recursive: true });
          await writeFile(join(root, E2E_OWNERSHIP_MARKER), JSON.stringify({ token: OWNER_TOKEN }), { mode: 0o600 });
          await writeFile(join(root, ...SEED_SEGMENTS, "status.json"), JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
        },
      },
    })).rejects.toThrow(/identity changed|snapshot root/);
    expect(await exists(join(displacedRoot, ...SEED_SEGMENTS))).toBe(true);
    expect(await exists(meetingRoot)).toBe(true);
  });

  it("fails closed when status bytes change through the same hard-linked inode after capture", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const statusPath = join(meetingRoot, "status.json");
    const savedStatus = join(meetingRoot, "captured-status.json");

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
      testHooks: {
        afterCapture: async () => {
          await rename(statusPath, savedStatus);
          await link(savedStatus, statusPath);
          await writeFile(statusPath, JSON.stringify({ id: OWNER_ID, titleOverride: `${OWNER_TITLE}-changed` }));
        },
      },
    })).rejects.toThrow(/identity changed|status bytes|status\.json.*single link/);
    expect(await exists(meetingRoot)).toBe(true);
    expect(await exists(savedStatus)).toBe(true);
  });

  it("preserves a leaf replacement raced immediately before quarantine", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    const displacedLeaf = join(root, "captured-original-leaf");

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
      testHooks: {
        afterRevalidateBeforeQuarantine: async () => {
          await rename(meetingRoot, displacedLeaf);
          await mkdir(meetingRoot, { recursive: true });
          await writeFile(join(meetingRoot, "status.json"), JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
          await writeFile(join(meetingRoot, "replacement-sentinel"), "must survive");
        },
      },
    })).rejects.toThrow(/quarantine identity|identity changed/);
    expect(await exists(displacedLeaf)).toBe(true);
    expect(await exists(join(meetingRoot, "replacement-sentinel"))).toBe(true);
  });

  it("refuses an arbitrary owned-looking root without actual runner ownership", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }), false);
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root,
      ownershipToken: "review-runner-token",
      project: "mobile-390",
      expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow("runner ownership");
    expect(await exists(meetingRoot)).toBe(true);
  });

  it("is a no-op when the owned seed is absent", async () => {
    const root = await tempRoot();
    await markOwned(root);
    await mkdir(join(root, "data", "meetings"), { recursive: true });
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).resolves.toMatchObject({ removed: false });
  });

  it("refuses to delete a directory whose status.json identity does NOT match", async () => {
    const { root, meetingRoot } = await seedMeeting(JSON.stringify({ id: OWNER_ID, titleOverride: "다른 회의" }));
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow("unrecognized");
    expect(await exists(meetingRoot)).toBe(true);
  });

  it("refuses to delete when status.json is unreadable (present dir, missing status)", async () => {
    const { root, meetingRoot } = await seedMeeting(null);
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow(/status\.json/);
    expect(await exists(meetingRoot)).toBe(true);
  });

  it("refuses to delete when status.json is malformed JSON", async () => {
    const { root, meetingRoot } = await seedMeeting("{ not valid json");
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow(/status\.json/);
    expect(await exists(meetingRoot)).toBe(true);
  });

  it("refuses to delete when status.json is a symlink to matching external identity", async () => {
    const { root, meetingRoot } = await seedMeeting(null);
    const externalStatus = join(root, "external-status.json");
    await writeFile(externalStatus, JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    await symlink(externalStatus, join(meetingRoot, "status.json"));

    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow(/status\.json.*real regular file/);
    expect(await exists(meetingRoot)).toBe(true);
    expect(await exists(externalStatus)).toBe(true);
  });

  it("refuses to delete through a symlinked meetings ancestor", async () => {
    const root = await tempRoot();
    await markOwned(root);
    const target = join(root, "real-meetings");
    await mkdir(join(target, OWNER_ID), { recursive: true });
    await writeFile(join(target, OWNER_ID, "status.json"), JSON.stringify({ id: OWNER_ID, titleOverride: OWNER_TITLE }));
    await mkdir(join(root, "data"), { recursive: true });
    await symlink(target, join(root, "data", "meetings"));
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: root, ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow("symlink component");
    expect(await exists(join(target, OWNER_ID))).toBe(true);
  });

  it("refuses to delete when handed an arbitrary absolute non-runner root", async () => {
    await expect(removeOwnedE2eMeetingSeed({
      snapshotRoot: "/tmp/unrelated", ownershipToken: OWNER_TOKEN, project: "mobile-390", expectedTitleOverride: OWNER_TITLE,
    })).rejects.toThrow("snapshot root");
  });
});

describe("E2E runner-root quarantine cleanup", () => {
  const OWNER_TOKEN = "fedcba9876543210";

  async function ownedRoot() {
    const root = await tempRoot();
    await writeFile(join(root, E2E_OWNERSHIP_MARKER), JSON.stringify({ token: OWNER_TOKEN }), { mode: 0o600 });
    await writeFile(join(root, "runner-sentinel"), "owned runner data");
    return root;
  }

  it("removes the exact owned runner root only after quarantine identity validation", async () => {
    const root = await ownedRoot();
    await expect(removeOwnedE2eSnapshotRoot({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
    })).resolves.toMatchObject({ removed: true });
    expect(await exists(root)).toBe(false);
  });

  it("preserves both roots when the runner root is replaced after capture", async () => {
    const root = await ownedRoot();
    const displacedRoot = `${root}-captured-original`;
    roots.push(displacedRoot);

    await expect(removeOwnedE2eSnapshotRoot({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      testHooks: {
        afterCapture: async () => {
          await rename(root, displacedRoot);
          await mkdir(root);
          await writeFile(join(root, E2E_OWNERSHIP_MARKER), JSON.stringify({ token: OWNER_TOKEN }), { mode: 0o600 });
          await writeFile(join(root, "replacement-sentinel"), "must survive");
        },
      },
    })).rejects.toThrow(/identity changed|snapshot root/);
    expect(await exists(join(displacedRoot, "runner-sentinel"))).toBe(true);
    expect(await exists(join(root, "replacement-sentinel"))).toBe(true);
  });

  it("preserves a runner-root replacement raced immediately before quarantine", async () => {
    const root = await ownedRoot();
    const displacedRoot = `${root}-pre-quarantine-original`;
    roots.push(displacedRoot);

    await expect(removeOwnedE2eSnapshotRoot({
      snapshotRoot: root,
      ownershipToken: OWNER_TOKEN,
      testHooks: {
        afterRevalidateBeforeQuarantine: async () => {
          await rename(root, displacedRoot);
          await mkdir(root);
          await writeFile(join(root, E2E_OWNERSHIP_MARKER), JSON.stringify({ token: OWNER_TOKEN }), { mode: 0o600 });
          await writeFile(join(root, "replacement-sentinel"), "must survive");
        },
      },
    })).rejects.toThrow(/quarantine identity|identity changed/);
    expect(await exists(join(displacedRoot, "runner-sentinel"))).toBe(true);
    expect(await exists(join(root, "replacement-sentinel"))).toBe(true);
  });
});
