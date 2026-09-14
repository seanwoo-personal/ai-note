// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMeetingLifecycleForTests } from "@/lib/meetingLifecycle";
import { meetingPaths } from "@/lib/paths";
import { initialStatus, readStatus, writeStatus } from "@/lib/status";
import { resetStatusUpdaterStateForTests } from "@/lib/statusUpdater";
import {
  enqueueTranscription,
  resetTranscriptionMonitorsForTests,
} from "@/lib/transcribe";

let originalCwd: string;
let workDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "soniox-transcribe-"));
  process.chdir(workDir);
  process.env.FAKE_SONIOX = "1";
  resetStatusUpdaterStateForTests();
  resetMeetingLifecycleForTests();
  resetTranscriptionMonitorsForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.FAKE_SONIOX;
  resetStatusUpdaterStateForTests();
  resetMeetingLifecycleForTests();
  resetTranscriptionMonitorsForTests();
  rmSync(workDir, { recursive: true, force: true });
});

async function seed(id: string) {
  const paths = meetingPaths(id);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.audio, "audio");
  await writeStatus(id, initialStatus(id, {
    startedAt: "2026-07-10T00:00:00.000Z",
    endedAt: "2026-07-10T00:01:00.000Z",
    durationMs: 60_000,
    audioMime: "audio/webm",
  }));
}

describe("Soniox 전사 발행", () => {
  it("원격 식별자를 내구성 있게 기록하고 segments 다음 raw 완료 마커를 발행한다", async () => {
    const id = "meeting-soniox-success";
    await seed(id);

    await expect(enqueueTranscription(id)).resolves.toMatchObject({
      ok: true,
      state: "sent",
      durability: "durable",
    });

    await vi.waitFor(async () => {
      expect((await readStatus(id))?.status).toBe("transcribed");
    });
    const paths = meetingPaths(id);
    expect(existsSync(paths.segments)).toBe(true);
    expect(existsSync(paths.raw)).toBe(true);
    expect(JSON.parse(readFileSync(paths.segments, "utf8"))).toEqual([
      { start: 0, end: 1, text: "테스트 회의 전사입니다." },
    ]);
    expect(readFileSync(paths.raw, "utf8")).toBe("테스트 회의 전사입니다.\n");
    expect((await readStatus(id))?.transcriptionDispatch).toMatchObject({
      state: "completed",
      service: "soniox",
    });
  });

  it("이미 발행된 raw 원문은 다시 전송하지 않는다", async () => {
    const id = "meeting-soniox-complete";
    await seed(id);
    await writeFile(meetingPaths(id).raw, "이미 완료됨\n");

    await expect(enqueueTranscription(id)).resolves.toEqual({
      ok: false,
      reason: "already_transcribed",
    });
  });

  it("키가 없으면 재시도 가능한 실패 상태를 유지하고 원본 오디오는 보존한다", async () => {
    const id = "meeting-soniox-no-key";
    await seed(id);
    delete process.env.FAKE_SONIOX;
    delete process.env.SONIOX_API_KEY;

    await expect(enqueueTranscription(id)).rejects.toThrow("soniox_key_missing");
    const status = await readStatus(id);
    expect(status?.transcriptionDispatch).toMatchObject({
      state: "proposed",
      service: "soniox",
    });
    expect(existsSync(meetingPaths(id).audio)).toBe(true);
    expect(existsSync(meetingPaths(id).raw)).toBe(false);
  });
});
