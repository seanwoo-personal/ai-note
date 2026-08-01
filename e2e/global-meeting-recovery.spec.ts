import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "./support/synthetic-test";

type ManualEditingFixtureModule = typeof import("../scripts/e2e-manual-editing-fixture.mjs");
type E2eHarnessModule = typeof import("../scripts/e2e-harness.mjs");
const importRuntimeModule = new Function(
  "specifier",
  "return import(specifier)",
) as <T>(specifier: string) => Promise<T>;
const runtimeModuleUrl = (relative: string) =>
  pathToFileURL(join(__dirname, relative)).href;
const fixtureModule = importRuntimeModule<ManualEditingFixtureModule>(
  runtimeModuleUrl("../scripts/e2e-manual-editing-fixture.mjs"),
);
// The canonical, symlink-fenced snapshot/cleanup contract lives in the repository-owned
// e2e harness (scripts/e2e-harness.mjs) — this spec delegates to it rather than
// duplicating a divergent, weaker containment check.
const harnessModule = importRuntimeModule<E2eHarnessModule>(
  runtimeModuleUrl("../scripts/e2e-harness.mjs"),
);

// Deterministic, headless, synthetic-only browser proof for the Global Meeting
// recovery work (AC13). No real Soniox/media/provider/network: the WebSocket,
// MediaRecorder, getUserMedia and the temporary-key/translate routes are all
// stubbed in-page so the REAL TestProductMeetingPanel runs end to end against
// fixture tokens. Runs across desktop-1440 + mobile-390 + mobile-320 (desktop +
// narrow). Screenshots and a machine-readable report are written to the
// gitignored test-results/global-meeting-recovery evidence directory.

const WORKSPACE_ID = "70000000-0000-4000-8000-000000000002";
const EVIDENCE_DIR = resolve("test-results/global-meeting-recovery");

// A Global Meeting export dates its filename; an ordinary meeting does not (D2). The
// dated prefix uses product-LOCAL wall-clock, not UTC (D1). We seed a transcript-only
// (Global Meeting) meeting per viewport with a fixed start instant and assert the
// exact local compact prefix computed the same way as src/lib/status.ts.
const GLOBAL_MEETING_STARTED_AT = "2026-07-05T13:30:00.000Z";
const GLOBAL_MEETING_ONE_LINE = "합성 글로벌 미팅에서 지역 시각 파일명과 자동 감지를 검증한다";

function localCompact(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Runner-owned data root the app server reads from (same root the fixture installs
// into). We only ADD a self-contained Global Meeting directory here — no library
// mutation is needed because the export route reads status/artifacts by id. The
// snapshot root is validated through the canonical repository-owned harness contract
// (absolute + lexically canonical + owned `ai-note-e2e-*` namespace) so this spec can
// never write into an arbitrary absolute directory handed via the environment.
async function e2eDataRoot(): Promise<string> {
  const harness = await harnessModule;
  return join(harness.resolveE2eSnapshotRoot(process.env.AI_NOTE_E2E_SNAPSHOT_ROOT ?? ""), "data");
}

// Seed a completed Global Meeting (recordingKind: "transcript_only", no audio) so the
// real export route can prove the Global-only, product-local dated filename.
async function seedGlobalMeeting(project: string): Promise<{ meetingId: string; startedAt: string }> {
  const meetingId = `synthetic-global-${project}`;
  const meetingRoot = join(await e2eDataRoot(), "meetings", meetingId);
  mkdirSync(meetingRoot, { recursive: true, mode: 0o700 });
  const transcript = "가상 글로벌 미팅 전사입니다. 실제 사용자 데이터가 아닙니다.\n";
  const summaryObject = {
    title: "합성 글로벌 미팅 — 실제 사용자 데이터 아님",
    topicSlug: "",
    participants: [],
    body: "가상 글로벌 미팅 회의록 본문입니다.",
    oneLine: "",
    purpose: "",
    highlights: [],
    discussion: [],
    decisions: [],
    actionItems: [],
    risks: [],
    followups: [],
  };
  // A manual body-only summary carries no oneLine, so the dated filename falls back to
  // the titleOverride (the user-confirmed Global Meeting name) — a real save-path shape.
  const summaryText = `${JSON.stringify(summaryObject, null, 2)}\n`;
  const status = {
    id: meetingId,
    title: "합성 글로벌 미팅 — 실제 사용자 데이터 아님",
    titleOverride: GLOBAL_MEETING_ONE_LINE,
    status: "summarized",
    error: null,
    startedAt: GLOBAL_MEETING_STARTED_AT,
    endedAt: GLOBAL_MEETING_STARTED_AT,
    durationMs: 600_000,
    recordingKind: "transcript_only",
    audioMime: "",
    whisper: { jobId: null, progress: 1 },
    paths: {
      audio: join(meetingRoot, "audio.webm"),
      play: join(meetingRoot, "play.webm"),
      raw: join(meetingRoot, "raw.md"),
      transcript: join(meetingRoot, "transcript.md"),
      summary: join(meetingRoot, "summary.json"),
      segments: join(meetingRoot, "segments.json"),
    },
    review: { participants: [] },
    contentRevision: {
      transcript: { source: "generated", sha256: sha256(transcript), updatedAt: GLOBAL_MEETING_STARTED_AT },
      summary: {
        source: "manual",
        sha256: sha256(summaryText),
        basedOnTranscriptSha256: sha256(transcript),
        updatedAt: GLOBAL_MEETING_STARTED_AT,
      },
    },
    updatedAt: GLOBAL_MEETING_STARTED_AT,
  };
  writeFileSync(join(meetingRoot, "transcript.md"), transcript, { mode: 0o600 });
  writeFileSync(join(meetingRoot, "summary.json"), summaryText, { mode: 0o600 });
  writeFileSync(join(meetingRoot, "status.json"), `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  return { meetingId, startedAt: GLOBAL_MEETING_STARTED_AT };
}

// Per-run/per-project isolation: this is the only spec that writes a real meeting
// directory into the SHARED runner-owned data root, and `reconcile()` materializes any
// live record into a library placement. Left in place it inflates the library across
// projects (smoke `visibleMeetingCount`, and the Home `limit=6` list installation reads),
// so we remove EXACTLY the directory this spec seeded after each test. The fail-closed
// containment + ownership contract lives in the repository-owned e2e harness
// (removeOwnedE2eMeetingSeed): it deletes ONLY a canonical, symlink-free descendant of
// the `ai-note-e2e-*` snapshot namespace whose own status.json proves this spec's stable
// identity (`id` + the user-confirmed `titleOverride`). Absence is a no-op; a symlinked
// component, an unreadable/malformed status, a mismatched identity, or a non-runner root
// throws WITHOUT deleting — the seed never touches baseline fixtures, real `data/`, the
// parent meetings/ tree, or `.env`, and never deletes on doubt.
async function removeGlobalMeetingSeed(project: string): Promise<void> {
  const harness = await harnessModule;
  await harness.removeOwnedE2eMeetingSeed({
    snapshotRoot: process.env.AI_NOTE_E2E_SNAPSHOT_ROOT ?? "",
    ownershipToken: process.env.AI_NOTE_E2E_OWNERSHIP_TOKEN ?? "",
    project,
    expectedTitleOverride: GLOBAL_MEETING_ONE_LINE,
  });
}

function installStubs() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  class FakeTrack {
    kind: string;
    readyState = "live";
    constructor(kind: string) { this.kind = kind; }
    addEventListener() {}
    removeEventListener() {}
    stop() { this.readyState = "ended"; }
  }
  class FakeStream {
    _tracks: FakeTrack[];
    constructor(tracks?: FakeTrack[]) {
      this._tracks = tracks && tracks.length ? tracks : [new FakeTrack("audio")];
    }
    getAudioTracks() { return this._tracks.filter((t) => t.kind === "audio"); }
    getVideoTracks() { return [] as FakeTrack[]; }
    getTracks() { return this._tracks; }
  }
  class FakeMediaRecorder {
    stream: unknown;
    state = "inactive";
    ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
    onstop: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(stream: unknown) { this.stream = stream; }
    start() { this.state = "recording"; }
    pause() { this.state = "paused"; this.onpause?.(); }
    resume() { this.state = "recording"; }
    requestData() { this.ondataavailable?.({ data: { size: 0 } }); }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  w.__sonioxSent = [];
  w.__sonioxSockets = [];
  const NativeWebSocket = w.WebSocket;
  class FakeWebSocket {
    url = "";
    readyState = 0;
    binaryType = "blob";
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string) {
      // Only intercept the Soniox realtime socket; delegate everything else
      // (e.g. the Next.js dev HMR socket) to the native implementation so the
      // page keeps working and no external network is touched.
      if (!String(url).includes("soniox")) return new NativeWebSocket(url);
      this.url = url;
      w.__sonioxSockets.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    send(data: unknown) { if (typeof data === "string") w.__sonioxSent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  w.WebSocket = FakeWebSocket;
  w.MediaStream = FakeStream;
  w.MediaRecorder = FakeMediaRecorder;
  const fakeDevices = {
    getUserMedia: async () => new FakeStream(),
    getDisplayMedia: async () => new FakeStream(),
  };
  try {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: fakeDevices });
  } catch {
    try {
      (navigator.mediaDevices as unknown as { getUserMedia: () => Promise<unknown> }).getUserMedia = fakeDevices.getUserMedia;
    } catch {
      // Last resort: leave native mediaDevices; the test will surface the blocker.
    }
  }
  w.__sonioxPush = (frame: unknown) => {
    const s = w.__sonioxSockets[w.__sonioxSockets.length - 1];
    s?.onmessage?.({ data: JSON.stringify(frame) });
  };
  // Deliver a frame to the most recent OPEN socket whose URL matches `match`
  // ("transcribe" = STT capture, "tts" = the TTS broadcast socket) so a live
  // TTS connection does not steal capture frames pushed during push-to-talk.
  w.__pushTo = (match: string, frame: unknown) => {
    const list = w.__sonioxSockets as Array<{ url: string; readyState: number; onmessage?: (e: { data: string }) => void }>;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const s = list[i];
      if (String(s.url).includes(match) && s.readyState === 1) {
        s.onmessage?.({ data: JSON.stringify(frame) });
        return true;
      }
    }
    return false;
  };
  // Deterministically terminate the current TTS broadcast so the speech phase
  // settles to "finished" (no real audio ever streams in the synthetic env).
  w.__settleTts = () => {
    const sent = w.__sonioxSent as string[];
    let streamId: string | null = null;
    for (const raw of sent) {
      try {
        const parsed = JSON.parse(raw) as { model?: string; stream_id?: string };
        if (parsed.model === "tts-rt-v1" && typeof parsed.stream_id === "string") streamId = parsed.stream_id;
      } catch {
        // ignore non-JSON control frames
      }
    }
    if (!streamId) return false;
    return w.__pushTo("tts", { stream_id: streamId, terminated: true });
  };
}

interface Frame {
  original: string;
  translated: string;
  source: string;
  speaker: number;
}

function endpointFrame(f: Frame) {
  return {
    tokens: [
      { text: f.original, is_final: true, speaker: String(f.speaker), language: f.source, translation_status: "original" },
      { text: f.translated, is_final: true, speaker: String(f.speaker), language: "ja", source_language: f.source, translation_status: "translation" },
      { text: "<end>", is_final: true, speaker: String(f.speaker), translation_status: "original" },
    ],
  };
}

// Representative KO/EN/ZH (+ later a mixed) sources, all translated toward the
// selected target (ja). Text is long enough to build a tall, scrollable log.
function makeFrames(count: number, offset: number): Frame[] {
  const sources = ["ko", "en", "zh"];
  const originals: Record<string, string> = {
    ko: "안녕하세요 오늘 회의를 시작하겠습니다 다들 준비되셨나요 지금부터 안건을 하나씩 확인합니다",
    en: "Hello everyone lets begin the meeting please share your updates for this sprint one by one",
    zh: "大家好 我们现在开始开会 请依次汇报本周的进展 谢谢配合",
  };
  const frames: Frame[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = offset + i;
    const source = sources[idx % sources.length];
    frames.push({
      original: `${idx + 1}. ${originals[source]}`,
      translated: `${idx + 1}. これは合成された翻訳テキストです 会議のスクロール検証のための十分な長さの行です`,
      source,
      speaker: (idx % 3) + 1,
    });
  }
  return frames;
}

async function pushFrames(page: import("@playwright/test").Page, frames: Frame[]) {
  for (const frame of frames) {
    await page.evaluate((f) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__sonioxPush(f);
    }, endpointFrame(frame));
  }
}

async function scrollMetrics(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement | null;
    if (!el) return null;
    return {
      scrollTop: Math.round(el.scrollTop),
      clientHeight: Math.round(el.clientHeight),
      scrollHeight: Math.round(el.scrollHeight),
      distanceFromBottom: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop),
    };
  });
}

// Per-control accessibility probe for a single required action-surface control. The
// control is first scrolled into the pinned sticky region (deterministic internal
// scroll — the narrow bar bounds its own overflow, so controls are reachable one at a
// time, NOT necessarily all simultaneously visible). We then record its rendered
// size, whether it is fully in the viewport at that point, a center hit-test, and
// programmatic focusability.
async function measureControl(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator,
) {
  const handle = await locator.elementHandle();
  if (!handle) return { found: false as const };
  const box = await page.evaluate((el) => {
    (el as HTMLElement).scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
    (el as HTMLElement).focus();
    const focusable = document.activeElement === el;
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      inViewport: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1,
      hitTestClickable: !!hit && (hit === el || (el as HTMLElement).contains(hit)),
      focusable,
    };
  }, handle);
  await handle.dispose();
  return { found: true as const, min44: box.width >= 44 && box.height >= 44, ...box };
}

test.describe("Global Meeting recovery — synthetic browser proof", () => {
  // Reset this spec's runner-owned seed before AND after each test so neither a prior
  // run's leftover nor this test's own seed can contaminate later specs/projects sharing
  // the single server data root. Fail-closed and ownership-scoped (see removeGlobalMeetingSeed).
  test.beforeEach(async ({}, testInfo) => removeGlobalMeetingSeed(testInfo.project.name));
  test.afterEach(async ({}, testInfo) => removeGlobalMeetingSeed(testInfo.project.name));

  test("per-utterance language ID, two-way payload, follow-bottom, sticky active controls with >=40% transcript, Global-only local-dated export", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    // A required action-surface control, scoped to the sticky controls region.
    const probeControl = (name: string) =>
      page.getByTestId("global-meeting-controls").getByRole("button", { name });

    // Local synthetic transport only — the ephemeral key and the passive
    // fallback translator are fulfilled in-process (no real provider/network).
    await page.route("**/api/realtime/temporary-key", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiKey: "synthetic-e2e-key" }),
    }));
    await page.route("**/api/translate", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ translation: "（合成された翻訳）" }),
    }));
    await page.addInitScript(installStubs);

    await page.goto(`/live?workspace=${WORKSPACE_ID}&tool=test-product`);
    await expect(page.getByRole("heading", { level: 1, name: "글로벌 미팅 번역" })).toBeVisible();

    // ---- AC1: truthful language settings; recognition remains per utterance --
    const input = page.getByRole("combobox", { name: "내 언어" });
    const target = page.getByRole("combobox", { name: "상대방 언어" });
    await expect(input).toHaveValue("ko");
    const inputOptions = await input.locator("option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value));
    expect(inputOptions[0]).toBe("ko");
    expect(inputOptions).not.toContain("auto");
    const inputLabel = await input.locator("option[value='ko']").textContent();

    // ---- AC1: user selects the translation target ---------------------------
    await target.selectOption("ja");
    await expect(target).toHaveValue("ja");

    // ---- AC6/AC7/AC8: the pre-start control is >=44px, reachable, focusable, and
    // activates via the KEYBOARD (no mouse). Starting the meeting this way proves real
    // keyboard operability of the start control (stubbed transport, no external network).
    const startControl = probeControl("미팅 시작");
    const startAccess = await measureControl(page, startControl);
    if (!startAccess.found) throw new Error("start control (미팅 시작) not found");
    expect(startAccess.min44).toBe(true);
    expect(startAccess.inViewport).toBe(true);
    expect(startAccess.hitTestClickable).toBe(true);
    expect(startAccess.focusable).toBe(true);
    await startControl.focus();
    await expect(startControl).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "미팅 종료" })).toBeVisible();

    // ---- AC1: observe the actual runtime request payload/config -------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect.poll(() => page.evaluate(() => (window as any).__sonioxSent?.length ?? 0)).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const observedConfig = await page.evaluate(() => JSON.parse((window as any).__sonioxSent[0]));
    expect(observedConfig).toBeTruthy();
    expect(observedConfig.enable_language_identification).toBe(true);
    expect(observedConfig.translation).toEqual({ type: "two_way", language_a: "ko", language_b: "ja" });

    // ---- Populate a tall transcript via fixture tokens ----------------------
    const firstBatch = makeFrames(18, 0);
    await pushFrames(page, firstBatch);
    const rows = page.getByRole("row", { name: /대화 행$/ });
    await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(18);

    // ---- AC4: follow-bottom autoscroll --------------------------------------
    // Wait for the follow effect to settle the container to the bottom.
    await expect.poll(async () => (await scrollMetrics(page))!.distanceFromBottom).toBeLessThanOrEqual(48);
    const followBefore = await scrollMetrics(page);
    expect(followBefore).not.toBeNull();
    expect(followBefore!.scrollHeight).toBeGreaterThan(followBefore!.clientHeight);
    expect(followBefore!.distanceFromBottom).toBeLessThanOrEqual(48);

    await pushFrames(page, makeFrames(6, 18));
    await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(24);
    await expect.poll(async () => (await scrollMetrics(page))!.distanceFromBottom).toBeLessThanOrEqual(48);
    const followAfter = await scrollMetrics(page);
    // scrollTop advanced (real scrollTop update) and stayed pinned to the bottom.
    expect(followAfter!.scrollTop).toBeGreaterThan(followBefore!.scrollTop);
    expect(followAfter!.distanceFromBottom).toBeLessThanOrEqual(48);

    // ---- AC4: manual scroll-up is not yanked down ---------------------------
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    const manualBefore = await scrollMetrics(page);
    expect(manualBefore!.scrollTop).toBe(0);
    await pushFrames(page, [
      { original: "코드스위칭 테스트 mixed language 混合 utterance", translated: "コードスイッチングのテスト混合発話です", source: "ko", speaker: 2 },
      ...makeFrames(3, 24),
    ]);
    await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(28);
    const manualAfter = await scrollMetrics(page);
    // New content arrived but the reader stayed near the top (not pulled to bottom).
    expect(manualAfter!.scrollTop).toBeLessThanOrEqual(48);
    expect(manualAfter!.distanceFromBottom).toBeGreaterThan(48);

    // ---- AC5 / AC10 / AC11: sticky, viewport-bounded, fully reachable controls
    const sticky = await page.evaluate(() => {
      const controls = document.querySelector("[data-testid='global-meeting-controls']") as HTMLElement;
      const scrollEl = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      const style = getComputedStyle(controls);
      const innerHeight = window.innerHeight;

      // Primary content scroll = the transcript's own scroll. Controls must NOT move.
      const beforeContent = controls.getBoundingClientRect();
      scrollEl.scrollTop = scrollEl.scrollHeight;
      const afterContent = controls.getBoundingClientRect();

      // Real page scroller: #app-content owns overflow on desktop (lg); the document
      // scrolls on narrow. Drive it fully — the adversarial case that clipped before.
      const appContent = document.getElementById("app-content");
      const scroller = (appContent && appContent.scrollHeight > appContent.clientHeight + 1)
        ? appContent
        : ((document.scrollingElement || document.documentElement) as HTMLElement);
      scroller.scrollTop = scroller.scrollHeight;
      const rect = controls.getBoundingClientRect();

      const reach = (text: string) => {
        const btn = Array.from(controls.querySelectorAll("button"))
          .find((b) => b.textContent?.includes(text)) as HTMLElement | undefined;
        if (!btn) return { found: false, inViewport: false, clickable: false };
        // Reach the control by scrolling inside the pinned region.
        btn.scrollIntoView({ block: "center" });
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) as HTMLElement | null;
        return {
          found: true,
          height: Math.round(r.height),
          inViewport: r.top >= -1 && r.bottom <= innerHeight + 1,
          clickable: !!hit && (hit === btn || btn.contains(hit)),
        };
      };
      const endControl = reach("미팅 종료");
      const broadcastControl = reach("송출 구간");
      const afterReach = controls.getBoundingClientRect();

      return {
        position: style.position,
        zIndex: style.zIndex,
        backgroundColorOpaque: style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent",
        innerHeight,
        scrollerIsAppContent: scroller === appContent,
        naturalTopBeforeScroll: Math.round(beforeContent.top),
        controlsUnmovedDuringContentScroll: Math.abs(afterContent.top - beforeContent.top) <= 1,
        topAfterPageScroll: Math.round(rect.top),
        bottomAfterPageScroll: Math.round(rect.bottom),
        controlsHeight: Math.round(rect.height),
        controlsInternallyScrollable: controls.scrollHeight > controls.clientHeight + 1,
        containerWithinViewport: rect.top >= -1 && rect.bottom <= innerHeight + 1,
        containerWithinViewportAfterReach: afterReach.top >= -1 && afterReach.bottom <= innerHeight + 1,
        endControl,
        broadcastControl,
      };
    });
    expect(sticky.position).toBe("sticky");
    expect(sticky.backgroundColorOpaque).toBe(true);
    // Controls stay fixed while the transcript content scrolls (the core AC5 guarantee).
    expect(sticky.controlsUnmovedDuringContentScroll).toBe(true);
    // The FULL controls container stays within the viewport after a full page scroll —
    // no negative-top clipping and no bottom overflowing the viewport.
    expect(sticky.containerWithinViewport).toBe(true);
    expect(sticky.containerWithinViewportAfterReach).toBe(true);
    // Meeting-end and broadcast-segment controls are each reachable (scrolled into the
    // pinned region) and hit-test clickable on every viewport.
    expect(sticky.endControl.found).toBe(true);
    expect(sticky.endControl.inViewport).toBe(true);
    expect(sticky.endControl.clickable).toBe(true);
    expect(sticky.broadcastControl.found).toBe(true);
    expect(sticky.broadcastControl.inViewport).toBe(true);
    expect(sticky.broadcastControl.clickable).toBe(true);
    await expect(page.getByRole("button", { name: "미팅 종료" })).toBeEnabled();
    await page.evaluate(() => {
      const appContent = document.getElementById("app-content");
      if (appContent) appContent.scrollTop = 0;
      const s = (document.scrollingElement || document.documentElement) as HTMLElement;
      s.scrollTop = 0;
    });

    // ---- AC5 (D3): transcript keeps >=40% of the viewport AND the sticky controls
    // never overlap it, in BOTH settled narrow states:
    //   (top)     the sticky bar pinned to the viewport top, transcript directly below;
    //   (content) the transcript read via its OWN internal scroll (overflow-y-auto) —
    //             the transcript is a sibling section below the bar, so scrolling its
    //             content advances the transcript in place; the bar and the section do
    //             not move, so nothing slides under the bar (overlap stays 0).
    // The reading model is the transcript's own scroll, NOT over-scrolling the page
    // (which would inherently slide any sibling under a sticky bar).
    const pinBar = () => page.evaluate(async () => {
      const controls = document.querySelector("[data-testid='global-meeting-controls']") as HTMLElement;
      const appContent = document.getElementById("app-content");
      const docScroller = (document.scrollingElement || document.documentElement) as HTMLElement;
      const scroller = (appContent && appContent.scrollHeight > appContent.clientHeight + 1) ? appContent : docScroller;
      // Reset first: once the bar is sticky its rect.top remains zero even if a
      // concurrent scroll-anchor update has over-scrolled the outer container.
      // Re-derive the one canonical pin offset from normal flow every time.
      scroller.scrollTop = 0;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      scroller.scrollTop = controls.getBoundingClientRect().top;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return scroller === appContent;
    });
    const measureTranscript = () => page.evaluate(() => {
      const controls = document.querySelector("[data-testid='global-meeting-controls']") as HTMLElement;
      const scrollEl = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      const innerHeight = window.innerHeight;
      const c = controls.getBoundingClientRect();
      const t = scrollEl.getBoundingClientRect();
      // Visible transcript = the transcript container area inside the viewport that the
      // sticky controls do NOT cover.
      const top = Math.max(t.top, c.bottom);
      const bottom = Math.min(t.bottom, innerHeight);
      const visible = Math.max(0, bottom - top);
      return {
        innerHeight,
        controlsTop: Math.round(c.top),
        controlsBottom: Math.round(c.bottom),
        controlsHeight: Math.round(c.height),
        transcriptTop: Math.round(t.top),
        transcriptBottom: Math.round(t.bottom),
        transcriptInternalScrollTop: Math.round(scrollEl.scrollTop),
        transcriptOverflows: scrollEl.scrollHeight > scrollEl.clientHeight + 1,
        visibleTranscriptPx: Math.round(visible),
        transcriptVisibleRatio: Math.round((visible / innerHeight) * 1000) / 1000,
        overlapPx: Math.round(Math.max(0, c.bottom - t.top)),
        controlsWithinViewport: c.top >= -1 && c.bottom <= innerHeight + 1,
      };
    });
    // Settled (top): reset the transcript's OWN scroll to the TOP first — an earlier
    // sticky check left it at the bottom — then pin the bar and confirm it is at top.
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      el.scrollTop = 0;
    });
    await pinBar();
    const transcriptTopState = await measureTranscript();
    // Settled (content-scrolled): advance the transcript's OWN scroll to the bottom,
    // then re-pin the bar (content scroll must not have moved it).
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });
    await pinBar();
    const transcriptScrolledState = await measureTranscript();
    const isNarrow = (page.viewportSize()?.width ?? 0) <= 390;
    for (const [label, state] of [["top", transcriptTopState], ["content-scrolled", transcriptScrolledState]] as const) {
      // >=40% of the viewport remains for the transcript, and the sticky controls do
      // NOT overlap the transcript container in either settled state.
      expect(state.transcriptVisibleRatio, `${label} ratio`).toBeGreaterThanOrEqual(0.4);
      expect(state.controlsWithinViewport, `${label} controls in viewport`).toBe(true);
      expect(state.overlapPx, `${label} overlap`).toBe(0);
    }
    // The top state must genuinely be at the TOP of the transcript, and the
    // content-scrolled state must have advanced its OWN scroll strictly beyond it,
    // while the sticky bar stayed put (no page over-scroll sliding content under it).
    expect(transcriptScrolledState.transcriptOverflows).toBe(true);
    expect(transcriptTopState.transcriptInternalScrollTop, "top state at transcript top").toBe(0);
    expect(
      transcriptScrolledState.transcriptInternalScrollTop,
      "content scroll advanced beyond top",
    ).toBeGreaterThan(transcriptTopState.transcriptInternalScrollTop);
    expect(transcriptScrolledState.controlsBottom).toBe(transcriptTopState.controlsBottom);
    // The fundamental bound: on narrow viewports the sticky controls never consume
    // more than 60% of the viewport, so >=40% is always available for content below
    // the bar (a 92dvh cap — the regression — would fail this).
    if (isNarrow) {
      expect(transcriptTopState.controlsHeight).toBeLessThanOrEqual(Math.round(transcriptTopState.innerHeight * 0.6));
    }

    // ---- AC6/AC7/AC8: complete required action surface — every control in the active
    // state is >=44px, focusable, and (via deterministic per-control internal scroll of
    // the pinned bar) reachable + hit-test clickable. The narrow bar bounds its own
    // overflow, so controls are reachable ONE AT A TIME — we do NOT claim simultaneity.
    const activeControls = [
      { key: "pause", name: "일시정지" },
      { key: "end", name: "미팅 종료" },
      { key: "broadcast", name: "송출 구간 시작" },
    ] as const;
    const controlAccessibility: Record<string, Awaited<ReturnType<typeof measureControl>>> = {};
    for (const control of activeControls) {
      const access = await measureControl(page, probeControl(control.name));
      controlAccessibility[control.key] = access;
      expect(access.found, `${control.key} found`).toBe(true);
      if (access.found) {
        expect(access.min44, `${control.key} >=44px`).toBe(true);
        expect(access.inViewport, `${control.key} reachable in viewport`).toBe(true);
        expect(access.hitTestClickable, `${control.key} hit-test clickable`).toBe(true);
        expect(access.focusable, `${control.key} focusable`).toBe(true);
      }
    }
    // Honest simultaneity report: whether all active controls are visible at once
    // without any internal scroll (not asserted — internal-scroll reachability is).
    const controlsSimultaneouslyVisible = await page.evaluate(() => {
      const region = document.querySelector("[data-testid='global-meeting-controls']") as HTMLElement;
      const names = ["일시정지", "미팅 종료", "송출 구간 시작"];
      const btns = Array.from(region.querySelectorAll("button"))
        .filter((b) => names.some((n) => b.textContent?.includes(n)));
      return btns.length === names.length && btns.every((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= -1 && r.bottom <= window.innerHeight + 1;
      });
    });

    // ---- AC8: ACTUAL keyboard activation of a safe, reversible control (pause↔resume),
    // via focus + Space — no mouse, no external transport.
    const pauseButton = probeControl("일시정지");
    await pauseButton.scrollIntoViewIfNeeded();
    await pauseButton.focus();
    await expect(pauseButton).toBeFocused();
    await page.keyboard.press("Space");
    const resumeButton = probeControl("이어서 진행");
    await expect(resumeButton).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "일시정지됨" })).toBeVisible();
    const keyboardPauseObserved = true;
    // Restore the listening state via the keyboard so downstream flow is unchanged.
    await resumeButton.scrollIntoViewIfNeeded();
    await resumeButton.focus();
    await page.keyboard.press("Enter");
    await expect(probeControl("일시정지")).toBeVisible();

    await page.evaluate(() => {
      const appContent = document.getElementById("app-content");
      if (appContent) appContent.scrollTop = 0;
      const s = (document.scrollingElement || document.documentElement) as HTMLElement;
      s.scrollTop = 0;
    });

    // ---- AC3 (D1+D2): Global Meeting dates md+json in product-LOCAL time; ordinary undated
    const ordinaryMeetingId = (await fixtureModule).manualEditingMeetingForProject(project).meetingId;
    const globalSeed = await seedGlobalMeeting(project);
    const exportName = (id: string, fmt: string) => page.evaluate(async ({ id, fmt }) => {
      const res = await fetch(`/api/meetings/${id}/export?fmt=${fmt}`, { cache: "no-store" });
      return { status: res.status, contentDisposition: res.headers.get("content-disposition") };
    }, { id, fmt });
    const decodeName = (cd: string | null) => decodeURIComponent((cd ?? "").split("UTF-8''")[1] ?? "");

    const ordinaryMd = await exportName(ordinaryMeetingId, "md");
    const ordinaryJson = await exportName(ordinaryMeetingId, "json");
    expect(ordinaryMd.status).toBe(200);
    expect(ordinaryJson.status).toBe(200);
    const ordinaryMdName = decodeName(ordinaryMd.contentDisposition);
    const ordinaryJsonName = decodeName(ordinaryJson.contentDisposition);
    // D2: ordinary meeting md+json filenames are NOT dated.
    expect(ordinaryMdName).not.toMatch(/^\d{8}_\d{6} /u);
    expect(ordinaryJsonName).not.toMatch(/^\d{8}_\d{6} /u);

    const globalMd = await exportName(globalSeed.meetingId, "md");
    const globalJson = await exportName(globalSeed.meetingId, "json");
    expect(globalMd.status).toBe(200);
    expect(globalJson.status).toBe(200);
    const globalMdName = decodeName(globalMd.contentDisposition);
    const globalJsonName = decodeName(globalJson.contentDisposition);
    const expectedGlobalBase = `${localCompact(globalSeed.startedAt)} ${GLOBAL_MEETING_ONE_LINE}`;
    // D1+D2: Global Meeting md+json dated with the LOCAL compact start prefix.
    expect(globalMdName).toBe(`${expectedGlobalBase}.md`);
    expect(globalJsonName).toBe(`${expectedGlobalBase}.json`);

    // ---- Screenshots represent the ASSERTED, DISTINCT settled states --------
    // 01: settled (top) — transcript reset to its OWN top, sticky bar pinned (overlap 0).
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      el.scrollTop = 0;
    });
    await pinBar();
    const shotTop = await page.screenshot({ path: resolve(EVIDENCE_DIR, `${project}-01-controls-top.png`), fullPage: false });
    // 02: settled (content-scrolled) — transcript advanced to the bottom via its OWN
    // scroll, bar unmoved (overlap 0). This is the state the no-overlap assertion measures.
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='global-meeting-transcript-scroll']") as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });
    await pinBar();
    const shotScrolled = await page.screenshot({ path: resolve(EVIDENCE_DIR, `${project}-02-scrolled-sticky.png`), fullPage: false });
    await page.screenshot({ path: resolve(EVIDENCE_DIR, `${project}-03-full.png`), fullPage: true });
    // The two settled-state screenshots must depict DIFFERENT transcript content — a
    // deterministic guard against re-capturing the same (already-scrolled) state.
    const shotTopHash = createHash("sha256").update(shotTop).digest("hex");
    const shotScrolledHash = createHash("sha256").update(shotScrolled).digest("hex");
    expect(shotTopHash, "01 vs 02 screenshots must differ").not.toBe(shotScrolledHash);

    // ---- Machine-readable per-viewport report -------------------------------
    const report = {
      requirement: "AC13-global-meeting-recovery",
      viewport: project,
      viewportSize: page.viewportSize(),
      route: `/live?workspace=${WORKSPACE_ID}&tool=test-product`,
      fixture: "ai-note-synthetic-library-v1",
      languageSettings: {
        inputValue: "ko",
        inputOptions,
        inputOptionLabel: inputLabel?.trim(),
      },
      selectedTarget: "ja",
      observedRequestConfig: {
        model: observedConfig.model,
        enable_language_identification: observedConfig.enable_language_identification,
        translation: observedConfig.translation,
      },
      followBottom: { before: followBefore, after: followAfter },
      manualScrollUp: { before: manualBefore, after: manualAfter },
      sticky,
      transcriptVisibility: {
        topState: transcriptTopState,
        scrolledState: transcriptScrolledState,
        floor: 0.4,
        noOverlapBothStates: transcriptTopState.overlapPx === 0 && transcriptScrolledState.overlapPx === 0,
        internalScrollAdvanced: transcriptScrolledState.transcriptInternalScrollTop > transcriptTopState.transcriptInternalScrollTop,
        screenshots: {
          topStatePng: `${project}-01-controls-top.png`,
          scrolledStatePng: `${project}-02-scrolled-sticky.png`,
          topStateSha256: shotTopHash,
          scrolledStateSha256: shotScrolledHash,
          distinct: shotTopHash !== shotScrolledHash,
        },
      },
      actionSurface: {
        // Deterministic per-control internal-scroll reachability — NOT a simultaneity claim.
        reachability: "per-control-internal-scroll",
        controlsSimultaneouslyVisible,
        start: startAccess,
        pause: controlAccessibility.pause,
        end: controlAccessibility.end,
        broadcast: controlAccessibility.broadcast,
        keyboard: {
          startActivatedByKeyboard: true,
          pauseToggledByKeyboard: keyboardPauseObserved,
        },
      },
      exportFilename: {
        ordinary: {
          meetingId: ordinaryMeetingId,
          mdStatus: ordinaryMd.status,
          jsonStatus: ordinaryJson.status,
          mdName: ordinaryMdName,
          jsonName: ordinaryJsonName,
          dated: false,
        },
        global: {
          meetingId: globalSeed.meetingId,
          startedAt: globalSeed.startedAt,
          mdStatus: globalMd.status,
          jsonStatus: globalJson.status,
          mdName: globalMdName,
          jsonName: globalJsonName,
          expectedBase: expectedGlobalBase,
          localTimestamp: localCompact(globalSeed.startedAt),
        },
      },
    };
    writeFileSync(
      resolve(EVIDENCE_DIR, `browser-report-${project}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await testInfo.attach(`global-meeting-measurements:${project}`, {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json",
    });
  });

  // Repeated Left Shift push-to-talk recovery (task t_7b6f15f0). Real browser, real
  // TestProductMeetingPanel, synthetic STT/TTS transport only. Proves that each cycle's
  // outbound utterance is broadcast (an outbound "· Push-to-Talk" row is committed and
  // no "완료된 발화를 찾지 못했습니다" abandon error appears) across multiple cycles, through the
  // finalizing→delayed-endpoint path, and under a diarization speaker-ID drift on a
  // later cycle (H1/H2/H3). The >8s absolute-timeout timing is covered deterministically
  // by the Vitest fake-timer unit suite (a live browser cannot fake that clock); this
  // spec proves the repeated-cycle runtime behavior end to end.
  test("repeated Left Shift push-to-talk broadcasts across cycles including a speaker-ID drift", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await page.route("**/api/realtime/temporary-key", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ apiKey: "synthetic-e2e-key" }),
    }));
    await page.route("**/api/translate", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ translation: "（合成された翻訳）" }),
    }));
    await page.addInitScript(installStubs);

    await page.goto(`/live?workspace=${WORKSPACE_ID}&tool=test-product`);
    await expect(page.getByRole("heading", { level: 1, name: "글로벌 미팅 번역" })).toBeVisible();

    // Start via the keyboard (no mouse), then reach the listening state.
    const startControl = page.getByTestId("global-meeting-controls").getByRole("button", { name: "미팅 시작" });
    await startControl.focus();
    await page.keyboard.press("Enter");
    const broadcastButton = page.getByRole("button", { name: "송출 구간 시작" });
    await expect(broadcastButton).toBeEnabled();

    const status = page.getByRole("status", { name: "Push-to-Talk 상태" });
    const outboundRows = page.getByText(/· Push-to-Talk$/);

    // Capture-frame builders (STT socket). A closing utterance ends with <fin> so the
    // opening-boundary + finalizing effects (both keyed on kind "fin") engage.
    const capFin = (speaker: number) => ({
      tokens: [{ text: "<fin>", is_final: true, speaker: String(speaker), translation_status: "original" }],
    });
    const capProv = (speaker: number, text: string) => ({
      tokens: [{ text, is_final: false, speaker: String(speaker), language: "ko", translation_status: "original" }],
    });
    const capFinal = (speaker: number, text: string) => ({
      tokens: [
        { text, is_final: true, speaker: String(speaker), language: "ko", translation_status: "original" },
        { text: "<fin>", is_final: true, speaker: String(speaker), translation_status: "original" },
      ],
    });
    const pushCap = (frame: unknown) => page.evaluate((f) => (window as any).__pushTo("transcribe", f), frame); // eslint-disable-line @typescript-eslint/no-explicit-any
    const settleTts = () => page.evaluate(() => (window as any).__settleTts()); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Press Left Shift with focus off any interactive control so the panel's window
    // keydown handler treats it as a push-to-talk toggle (not a text-input target).
    const leftShift = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Shift");
    };

    const cycles = [
      { open: 1, speak: 2, text: "첫 번째 발언입니다 잘 부탁드립니다", drift: false },
      { open: 1, speak: 3, text: "두 번째 안건을 말씀드리겠습니다", drift: true },
      { open: 3, speak: 3, text: "마지막으로 정리하겠습니다 감사합니다", drift: false },
    ];

    const cycleReports: Array<Record<string, unknown>> = [];
    for (let i = 0; i < cycles.length; i += 1) {
      const cycle = cycles[i];
      await expect(broadcastButton).toBeEnabled();
      const before = await outboundRows.count();

      await leftShift();                                  // open the segment
      await expect(status).toContainText("내 송출 구간");    // recording (set synchronously on open)
      await pushCap(capFin(cycle.open));                  // opening flush boundary
      await pushCap(capProv(cycle.speak, cycle.text));    // user speaks (provisional, no endpoint yet)
      // Readiness sync (NOT a sleep): the closing Left Shift reads the panel's CURRENT
      // capture.transcript, so we must wait until the provisional has actually rendered
      // into the live transcript before closing. Gating only on the recording status is
      // insufficient — that phase is set on open, independent of the provisional frame —
      // and closing too early makes the panel freeze an empty utterance (idle, not finalizing).
      await expect(page.getByText(cycle.text).first()).toBeVisible();

      await leftShift();                                  // close the segment
      await expect(status).toContainText("마지막 토큰 확정 중"); // finalizing, awaiting the boundary

      await pushCap(capFinal(cycle.speak, cycle.text));   // the (delayed) final boundary lands

      // The utterance is broadcast: a new outbound row is committed and no abandon fires.
      await expect(outboundRows).toHaveCount(before + 1);
      await expect(page.getByText(`Speaker ${cycle.speak} · Push-to-Talk`).last()).toBeVisible();
      await expect(page.getByText("완료된 발화를 찾지 못했습니다")).toHaveCount(0);

      // Settle the synthetic TTS so the phase returns and the next cycle can start.
      await expect.poll(async () => settleTts()).toBe(true);
      await expect(broadcastButton).toBeEnabled();

      cycleReports.push({
        cycle: i + 1,
        openSpeaker: cycle.open,
        speakSpeaker: cycle.speak,
        drift: cycle.drift,
        outboundRowsAfter: before + 1,
        broadcastRowLabel: `Speaker ${cycle.speak} · Push-to-Talk`,
      });
    }

    await expect(outboundRows).toHaveCount(cycles.length);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, `${project}-04-ptt-repeated.png`), fullPage: true });

    const pttReport = {
      requirement: "AC5-AC7-push-to-talk-recovery",
      task: "t_7b6f15f0",
      viewport: project,
      viewportSize: page.viewportSize(),
      route: `/live?workspace=${WORKSPACE_ID}&tool=test-product`,
      cyclesRun: cycles.length,
      cycles: cycleReports,
      totalOutboundRows: await outboundRows.count(),
      abandonErrors: await page.getByText("완료된 발화를 찾지 못했습니다").count(),
      unexpectedConsoleErrors: consoleErrors,
      liveProviderLimitation: "Synthetic STT/TTS transport only; the >8s absolute-timeout timing is proven deterministically by the Vitest fake-timer unit suite.",
      screenshot: `${project}-04-ptt-repeated.png`,
    };
    writeFileSync(resolve(EVIDENCE_DIR, `ptt-recovery-report-${project}.json`), `${JSON.stringify(pttReport, null, 2)}\n`);
    await testInfo.attach(`ptt-recovery:${project}`, {
      body: Buffer.from(JSON.stringify(pttReport, null, 2)),
      contentType: "application/json",
    });
    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});
