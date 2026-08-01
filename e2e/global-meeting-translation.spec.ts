import type { Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "./support/synthetic-test";

// The Global Meeting translator depends on live-only transports the synthetic
// harness intentionally forbids (microphone, the Soniox STT WebSocket, external
// network). This spec installs synthetic, fail-closed **browser** stubs of those
// exact transports (fake getUserMedia/MediaStream/MediaRecorder and a WebSocket
// proxy that only intercepts soniox.com) plus local route stubs for the
// same-origin endpoints, then drives the REAL TestProductMeetingPanel in a real
// browser. No product seam is added; no real provider/mic/network is used.

type ManualEditingFixtureModule = typeof import("../scripts/e2e-manual-editing-fixture.mjs");
const importRuntimeModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<ManualEditingFixtureModule>;
const fixtureModule = importRuntimeModule(pathToFileURL(join(
  __dirname,
  "../scripts/e2e-manual-editing-fixture.mjs",
)).href);

const LIVE_URL = "/live?workspace=70000000-0000-4000-8000-000000000002&tool=test-product";
const EVIDENCE_DIR = process.env.AI_NOTE_GLOBAL_MEETING_EVIDENCE_DIR
  ?? "test-results/integration-t_923038c8/screenshots";

// Installed in-page before any product script runs. Self-contained (serialized
// by Playwright), fail-closed: it only touches soniox.com WebSockets and leaves
// every other transport (including Next HMR) on the real implementation.
function installSonioxBrowserFakes() {
  const w = window as unknown as Record<string, unknown> & typeof globalThis;
  const bag: {
    sentConfig: Record<string, unknown> | null;
    lastSocket: FakeWS | null;
    startCount: number;
    emit(result: unknown): void;
    emitUtterance(speaker: string, orig: string, origLang: string, trans: string, transLang: string): void;
  } = {
    sentConfig: null,
    lastSocket: null,
    startCount: 0,
    emit() {},
    emitUtterance() {},
  };
  (w as Record<string, unknown>).__ai_e2e = bag;

  class FakeTrack {
    kind = "audio";
    readyState = "live";
    enabled = true;
    stop() { this.readyState = "ended"; }
    addEventListener() {}
    removeEventListener() {}
  }
  class FakeStream {
    private _tracks: FakeTrack[];
    constructor(tracks?: FakeTrack[]) {
      this._tracks = tracks && tracks.length ? tracks.slice() : [new FakeTrack()];
    }
    getTracks() { return this._tracks.slice(); }
    getAudioTracks() { return this._tracks.filter((t) => t.kind === "audio"); }
    getVideoTracks() { return []; }
    addEventListener() {}
    removeEventListener() {}
  }
  try { Object.defineProperty(w, "MediaStream", { value: FakeStream, configurable: true, writable: true }); } catch { /* noop */ }

  const md = (navigator.mediaDevices || {}) as unknown as Record<string, unknown>;
  const getUM = () => { bag.startCount += 1; return Promise.resolve(new FakeStream([new FakeTrack()])); };
  try { md.getUserMedia = getUM; } catch { try { Object.defineProperty(md, "getUserMedia", { value: getUM, configurable: true }); } catch { /* noop */ } }
  const getDM = () => Promise.resolve(new FakeStream([new FakeTrack()]));
  try { md.getDisplayMedia = getDM; } catch { /* noop */ }
  try { Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true }); } catch { /* noop */ }

  class FakeRecorder {
    state: "inactive" | "recording" | "paused" = "inactive";
    ondataavailable: ((event: { data: { size: number } }) => void) | null = null;
    onpause: (() => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onstart: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; this.onstart?.(); }
    pause() { this.state = "paused"; this.onpause?.(); }
    resume() { this.state = "recording"; }
    requestData() { this.ondataavailable?.({ data: { size: 0 } }); }
    stop() { if (this.state === "inactive") return; this.state = "inactive"; this.onstop?.(); }
  }
  try { Object.defineProperty(w, "MediaRecorder", { value: FakeRecorder, configurable: true, writable: true }); } catch { /* noop */ }

  class FakeWS {
    url: string;
    readyState = 0;
    binaryType = "blob";
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url: string) {
      this.url = String(url);
      bag.lastSocket = this;
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(data: unknown) {
      if (typeof data === "string") {
        if (data === "") { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ finished: true }) }), 0); return; }
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (parsed && parsed.model) bag.sentConfig = parsed;
        } catch { /* ignore finalize / non-config frames */ }
      }
    }
    close() { this.readyState = 3; this.onclose?.({}); }
    addEventListener() {}
    removeEventListener() {}
  }
  const RealWS = w.WebSocket;
  w.WebSocket = new Proxy(RealWS, {
    construct(target, args: unknown[]) {
      const url = String(args[0] ?? "");
      if (url.indexOf("soniox.com") !== -1) return new FakeWS(url) as unknown as WebSocket;
      return Reflect.construct(target, args as never[]);
    },
  }) as typeof WebSocket;

  bag.emit = (result: unknown) => {
    const s = bag.lastSocket;
    if (s && s.onmessage) s.onmessage({ data: JSON.stringify(result) });
  };
  bag.emitUtterance = (speaker, orig, origLang, trans, transLang) => {
    bag.emit({ tokens: [
      { text: orig, is_final: true, speaker, language: origLang, translation_status: "original" },
      { text: trans, is_final: true, speaker, language: transLang, source_language: origLang, translation_status: "translation" },
      { text: "<end>", is_final: true, speaker, translation_status: "original" },
    ] });
  };
}

type SessionCall = { url: string; body: unknown };
type NetworkEvent = {
  type: "request" | "response" | "requestfailed";
  method: string;
  url: string;
  status?: number;
  failure?: string | null;
};

async function installHarness(
  page: Page,
  options: {
    temporaryKeyFailures?: number;
    temporaryKeyDelayMs?: number;
    temporaryKeyFailureMode?: "invalid-payload" | "abort" | "http-503";
  } = {},
): Promise<{
  sessionCalls: SessionCall[];
  deleteCalls: string[];
  temporaryKeyCalls: { count: number };
  networkEvents: NetworkEvent[];
}> {
  const sessionCalls: SessionCall[] = [];
  const deleteCalls: string[] = [];
  const temporaryKeyCalls = { count: 0 };
  const networkEvents: NetworkEvent[] = [];
  await page.addInitScript(installSonioxBrowserFakes);

  page.on("request", (request) => {
    if (request.url().includes("/api/realtime/temporary-key")) {
      networkEvents.push({ type: "request", method: request.method(), url: request.url() });
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/realtime/temporary-key")) {
      networkEvents.push({
        type: "response",
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/realtime/temporary-key")) {
      networkEvents.push({
        type: "requestfailed",
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText ?? null,
      });
    }
  });

  await page.route("**/api/realtime/temporary-key", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    temporaryKeyCalls.count += 1;
    if (options.temporaryKeyDelayMs) await new Promise((resolve) => setTimeout(resolve, options.temporaryKeyDelayMs));
    if (temporaryKeyCalls.count <= (options.temporaryKeyFailures ?? 0)) {
      if (options.temporaryKeyFailureMode === "abort") return route.abort("failed");
      if (options.temporaryKeyFailureMode === "http-503") {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "synthetic_service_unavailable" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "synthetic_network_failure" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiKey: "synthetic-e2e-temporary-key" }),
    });
  });
  await page.route("**/api/translate", async (route) => {
    const payload = route.request().postDataJSON() as { text?: string } | null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ translation: `${payload?.text ?? ""} ⟶(t)` }),
    });
  });
  await page.route(/\/api\/meetings\/[^/]+\/session$/, async (route) => {
    sessionCalls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "synthetic-saved-meeting", status: "summarized" }),
    });
  });

  page.on("request", (request) => {
    if (request.method() === "DELETE") deleteCalls.push(request.url());
  });

  return { sessionCalls, deleteCalls, temporaryKeyCalls, networkEvents };
}

// The in-flow primary button, never the floating mirror (which also exposes
// aria-label "미팅 시작"). Keeps locators unambiguous when the page is scrolled.
function inFlowStart(page: Page) {
  return page.locator("button:not([data-floating-primary])", { hasText: "미팅 시작" });
}

async function startAndListen(page: Page) {
  await inFlowStart(page).click();
  // Enabled push-to-talk button ⇒ capture.phase === "listening" ⇒ the Soniox
  // socket's onmessage handler is attached and it is safe to inject utterances.
  await expect(page.getByRole("button", { name: "송출 구간 시작" })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => {
      const bag = (window as unknown as { __ai_e2e?: { sentConfig?: { model?: string } } }).__ai_e2e;
      return bag?.sentConfig?.model ?? null;
    }))
    .toBe("stt-rt-v5");
}

async function emitUtterance(page: Page, speaker: string, orig: string, origLang: string, trans: string, transLang: string) {
  await page.evaluate(({ speaker, orig, origLang, trans, transLang }) => {
    (window as unknown as { __ai_e2e: { emitUtterance(s: string, o: string, ol: string, t: string, tl: string): void } })
      .__ai_e2e.emitUtterance(speaker, orig, origLang, trans, transLang);
  }, { speaker, orig, origLang, trans, transLang });
}

async function scrollShell(page: Page, to: "top" | "bottom") {
  await page.evaluate((pos) => {
    const top = pos === "bottom" ? 1e7 : 0;
    const content = document.getElementById("app-content");
    if (content) content.scrollTo(0, top);
    window.scrollTo(0, top);
  }, to);
}

async function saveShot(page: Page, testInfo: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: true, caret: "initial" });
  await testInfo.attach(`browser-screenshot:${name}`, { body, contentType: "image/png" });
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-${name}.png`), body);
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function floatingTranscriptGeometry(page: Page) {
  return page.evaluate(() => {
    const floating = document.querySelector<HTMLElement>("[data-floating-primary]");
    const transcript = document.querySelector<HTMLElement>("[data-testid='global-meeting-transcript-scroll']");
    if (!floating || !transcript) throw new Error("floating CTA and transcript must both be rendered");

    const cta = floating.getBoundingClientRect();
    const transcriptRect = transcript.getBoundingClientRect();
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const intersect = (a: DOMRect | typeof viewport, b: DOMRect | typeof viewport) => {
      const left = Math.max(a.left, b.left);
      const right = Math.min(a.right, b.right);
      const top = Math.max(a.top, b.top);
      const bottom = Math.min(a.bottom, b.bottom);
      return {
        left,
        right,
        top,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        area: Math.max(0, right - left) * Math.max(0, bottom - top),
      };
    };
    const visibleTranscript = intersect(transcriptRect, viewport);
    const containerOverlap = intersect(visibleTranscript, cta);
    const visibleChildRects = Array.from(transcript.querySelectorAll<HTMLElement>("div, table, thead, tbody, tr, th, td, p, span"))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .flatMap((element) => Array.from(element.getClientRects()).map((rect) => ({
        element: element.tagName.toLowerCase(),
        text: element.innerText.trim().slice(0, 120),
        rect: intersect(intersect(rect, visibleTranscript), viewport),
      })))
      .filter(({ rect }) => rect.area > 0);
    const visibleTextRects = visibleChildRects.filter(({ text }) => text.length > 0);
    const childOverlaps = visibleChildRects
      .map(({ element, text, rect }) => ({ element, text, rect: intersect(rect, cta) }))
      .filter(({ rect }) => rect.area > 0);
    const textOverlaps = visibleTextRects
      .map(({ element, text, rect }) => ({ element, text, rect: intersect(rect, cta) }))
      .filter(({ rect }) => rect.area > 0);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cta: { left: cta.left, right: cta.right, top: cta.top, bottom: cta.bottom, width: cta.width, height: cta.height },
      transcript: { left: transcriptRect.left, right: transcriptRect.right, top: transcriptRect.top, bottom: transcriptRect.bottom },
      visibleTranscript,
      containerOverlap,
      visibleChildRectCount: visibleChildRects.length,
      childOverlapRectCount: childOverlaps.length,
      childOverlapArea: childOverlaps.reduce((sum, item) => sum + item.rect.area, 0),
      childOverlaps,
      visibleTextRectCount: visibleTextRects.length,
      overlapRectCount: textOverlaps.length,
      overlapArea: textOverlaps.reduce((sum, item) => sum + item.rect.area, 0),
      unreadableRectCount: textOverlaps.length,
      clipping: Number(cta.left < 0 || cta.right > window.innerWidth || cta.top < 0 || cta.bottom > window.innerHeight),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function focusedControlSnapshot(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) throw new Error("no active element after keyboard navigation");
    const style = getComputedStyle(element);
    const labelText = element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement
      ? Array.from(element.labels ?? []).map((label) => label.innerText.trim()).join(" ")
      : "";
    return {
      tag: element.tagName.toLowerCase(),
      accessibleName: element.getAttribute("aria-label") || labelText || element.innerText.trim(),
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      floating: element.hasAttribute("data-floating-primary"),
      latest: element.getAttribute("aria-label") === "최신 내용 보기",
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      color: style.color,
      backgroundColor: style.backgroundColor,
    };
  });
}

function expectThreePixelFocus(snapshot: Awaited<ReturnType<typeof focusedControlSnapshot>>) {
  expect(snapshot.disabled).toBe(false);
  expect(Number.parseFloat(snapshot.outlineWidth)).toBeGreaterThanOrEqual(3);
  expect(snapshot.outlineStyle).toBe("solid");
  expect(snapshot.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
}

type FocusAuditRecord = Awaited<ReturnType<typeof auditFocusedControl>>;

async function auditFocusedControl(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element?.dataset.focusAuditId) throw new Error("focused element is outside the state inventory");
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const [red = 0, green = 0, blue = 0] = parse(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const contrast = (a: string, b: string) => {
      const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const opaqueBackground = (start: HTMLElement | null) => {
      let current = start;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== "transparent" && value !== "rgba(0, 0, 0, 0)") return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const style = getComputedStyle(element);
    const ownBackground = opaqueBackground(element);
    const outsideBackground = opaqueBackground(element.parentElement);
    const all = Array.from(document.querySelectorAll("*"));
    return {
      id: element.dataset.focusAuditId,
      accessibleName: element.dataset.focusAuditName ?? "",
      role: element.dataset.focusAuditRole ?? "",
      domOrder: all.indexOf(element),
      tag: element.tagName.toLowerCase(),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      focusVisible: element.matches(":focus-visible"),
      color: style.color,
      backgroundColor: ownBackground,
      outsideBackgroundColor: outsideBackground,
      textContrast: contrast(style.color, ownBackground),
      outlineContrast: contrast(style.outlineColor, outsideBackground),
    };
  });
}

async function auditStateFocus(page: Page, state: string) {
  const scrollState = await page.evaluate(() => ({
    windowX: window.scrollX,
    windowY: window.scrollY,
    appContent: document.querySelector<HTMLElement>("[data-testid='app-content']")?.scrollTop ?? null,
    transcript: document.querySelector<HTMLElement>("[data-testid='global-meeting-transcript-scroll']")?.scrollTop ?? null,
  }));
  const inventory = await page.evaluate((stateName) => {
    const selector = "a[href], button, input, select, textarea, [tabindex]";
    document.querySelectorAll<HTMLElement>("[data-focus-audit-id], [data-disabled-audit-id]").forEach((element) => {
      delete element.dataset.focusAuditId;
      delete element.dataset.focusAuditName;
      delete element.dataset.focusAuditRole;
      delete element.dataset.disabledAuditId;
    });
    const modal = document.querySelector<HTMLDialogElement>("dialog[open]");
    const candidates = Array.from((modal ?? document).querySelectorAll<HTMLElement>(selector));
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 0
        && rect.height > 0
        && !element.closest("[inert]")
        && element.getAttribute("aria-hidden") !== "true";
    };
    const name = (element: HTMLElement) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ")
        : "";
      const labels = "labels" in element
        ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.innerText.trim()).join(" ")
        : "";
      return element.getAttribute("aria-label") || labelledText || labels || element.innerText.trim() || element.getAttribute("title") || "";
    };
    const role = (element: HTMLElement) => element.getAttribute("role") || ({
      A: "link", BUTTON: "button", INPUT: (element as HTMLInputElement).type === "text" ? "textbox" : "input",
      SELECT: "combobox", TEXTAREA: "textbox",
    } as Record<string, string>)[element.tagName] || "focusable";
    const enabled = candidates.filter((element) => visible(element)
      && element.tabIndex >= 0
      && !element.matches(":disabled")
      && element.getAttribute("aria-disabled") !== "true");
    const disabled = candidates.filter((element) => visible(element)
      && (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true"))
      .map((element, index) => {
        const id = `${stateName}-disabled-${index}`;
        element.dataset.disabledAuditId = id;
        return {
          id,
          accessibleName: name(element),
          role: role(element),
          tabIndex: element.tabIndex,
          nativeDisabled: element.matches(":disabled"),
          ariaDisabled: element.getAttribute("aria-disabled") === "true",
          domOrder: Array.from(document.querySelectorAll("*")).indexOf(element),
        };
      });
    return {
      enabled: enabled.map((element, index) => {
        const accessibleName = name(element);
        const id = `${stateName}-${index}`;
        element.dataset.focusAuditId = id;
        element.dataset.focusAuditName = accessibleName;
        element.dataset.focusAuditRole = role(element);
        return { id, accessibleName, role: role(element), domOrder: Array.from(document.querySelectorAll("*")).indexOf(element) };
      }),
      disabled,
      scope: modal ? "modal-dialog" : "document",
    };
  }, state);
  expect(inventory.enabled.length, `${state} enabled inventory must be non-empty`).toBeGreaterThan(0);
  expect(inventory.enabled.every((item) => item.accessibleName.length > 0), `${state} accessible names`).toBe(true);
  expect(inventory.disabled.every((item) => item.accessibleName.length > 0), `${state} disabled accessible names`).toBe(true);
  expect(inventory.disabled.every((item) => item.nativeDisabled || item.ariaDisabled), `${state} disabled state`).toBe(true);

  const traverse = async (key: "Tab" | "Shift+Tab") => {
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus({ preventScroll: true });
    });
    const records: FocusAuditRecord[] = [];
    const observed: string[] = [];
    let repeated: string | null = null;
    let closure: "body" | "repeat" | null = null;
    let bodyBoundaryCount = 0;
    let mirroredPrimaryTransitions = 0;
    const initialId = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.focusAuditId ?? null);
    if (initialId) {
      const initial = await auditFocusedControl(page);
      expectThreePixelFocus({ ...initial, disabled: false, floating: false, latest: false });
      expect(initial.focusVisible).toBe(true);
      expect(initial.textContrast).toBeGreaterThanOrEqual(4.5);
      expect(initial.outlineContrast).toBeGreaterThanOrEqual(3);
      records.push(initial);
      observed.push(initial.id);
    }
    for (let step = 0; step < inventory.enabled.length + 3; step += 1) {
      await page.keyboard.press(key);
      const active = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (element?.hasAttribute("data-floating-primary") && !element.dataset.focusAuditId) {
          const accessibleName = element.getAttribute("aria-label") || element.innerText.trim();
          const peer = Array.from(document.querySelectorAll<HTMLElement>("[data-focus-audit-id]"))
            .find((candidate) => (candidate.getAttribute("aria-label") || candidate.innerText.trim()) === accessibleName);
          if (peer) {
            element.dataset.focusAuditId = peer.dataset.focusAuditId ?? "";
            element.dataset.focusAuditName = peer.dataset.focusAuditName ?? accessibleName;
            element.dataset.focusAuditRole = peer.dataset.focusAuditRole ?? "button";
          }
        }
        return {
          id: element?.dataset.focusAuditId ?? null,
          disabledId: element?.dataset.disabledAuditId ?? null,
          body: element === document.body,
          floating: element?.hasAttribute("data-floating-primary") ?? false,
          descriptor: element ? `${element.tagName.toLowerCase()}[${element.getAttribute("aria-label") ?? element.innerText.trim().slice(0, 80)}]` : "none",
        };
      });
      expect(active.disabledId, `${state} ${key} must skip disabled controls`).toBeNull();
      if (active.body) {
        bodyBoundaryCount += 1;
        if (observed.length > 0) {
          closure = "body";
          break;
        }
        continue;
      }
      expect(active.id, `${state} ${key} encountered uninventoried ${active.descriptor}`).not.toBeNull();
      if (active.floating && active.id && observed.includes(active.id)) {
        mirroredPrimaryTransitions += 1;
        continue;
      }
      if (active.id === observed[0]) {
        repeated = active.id;
        closure = "repeat";
        break;
      }
      const record = await auditFocusedControl(page);
      expectThreePixelFocus({ ...record, disabled: false, floating: false, latest: false });
      expect(record.focusVisible).toBe(true);
      expect(record.textContrast).toBeGreaterThanOrEqual(4.5);
      expect(record.outlineContrast).toBeGreaterThanOrEqual(3);
      records.push(record);
      observed.push(record.id);
    }
    const inventoryIds = inventory.enabled.map((item) => item.id);
    const initialIndex = observed.length > 0 ? inventoryIds.indexOf(observed[0]) : -1;
    const expected = initialIndex < 0
      ? (key === "Tab" ? inventoryIds : [...inventoryIds].reverse())
      : key === "Tab"
        ? [...inventoryIds.slice(initialIndex), ...inventoryIds.slice(0, initialIndex)]
        : [
          inventoryIds[initialIndex],
          ...inventoryIds.slice(0, initialIndex).reverse(),
          ...inventoryIds.slice(initialIndex + 1).reverse(),
        ];
    expect(observed, `${state} ${key} exact one-cycle order`).toEqual(expected);
    expect(new Set(observed).size, `${state} ${key} duplicate controls`).toBe(observed.length);
    expect(bodyBoundaryCount, `${state} ${key} body boundary count`).toBeLessThanOrEqual(2);
    expect(closure, `${state} ${key} must close exactly one cycle`).not.toBeNull();
    if (closure === "repeat") expect(repeated).toBe(expected[0]);
    const disabledAfter = await page.locator("[data-disabled-audit-id]").evaluateAll((elements) => elements.map((element) => ({
      id: (element as HTMLElement).dataset.disabledAuditId,
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
    })));
    expect(disabledAfter.every((item) => item.disabled), `${state} disabled controls must remain disabled`).toBe(true);
    return { records, sequence: observed, repeated, closure, bodyBoundaryCount, mirroredPrimaryTransitions };
  };

  const forward = await traverse("Tab");
  await page.evaluate((saved) => {
    window.scrollTo(saved.windowX, saved.windowY);
    const appContent = document.querySelector<HTMLElement>("[data-testid='app-content']");
    if (appContent && saved.appContent !== null) appContent.scrollTop = saved.appContent;
    const transcript = document.querySelector<HTMLElement>("[data-testid='global-meeting-transcript-scroll']");
    if (transcript && saved.transcript !== null) transcript.scrollTop = saved.transcript;
  }, scrollState);
  await page.waitForTimeout(100);
  const reverse = await traverse("Shift+Tab");
  return { state, inventory, forward, reverse };
}

async function auditFloatingPrimaryFocus(page: Page, testInfo: TestInfo, state: string, artifactLabel: string) {
  const target = page.locator("[data-floating-primary]");
  await expect(target).toBeVisible();
  const inventory = await target.evaluate((element, stateName) => {
    const control = element as HTMLElement;
    const id = `${stateName}-floating-primary`;
    control.dataset.focusAuditId = id;
    control.dataset.focusAuditName = control.getAttribute("aria-label") || control.innerText.trim();
    control.dataset.focusAuditRole = control.getAttribute("role") || "button";
    return {
      enabled: [{
        id,
        accessibleName: control.dataset.focusAuditName,
        role: control.dataset.focusAuditRole,
        domOrder: Array.from(document.querySelectorAll("*")).indexOf(control),
      }],
      disabled: [],
      scope: "floating-primary",
    };
  }, state);
  const traverse = async (key: "Tab" | "Shift+Tab") => {
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus({ preventScroll: true });
    });
    const activeElements: Array<{
      step: number;
      tag: string | null;
      accessibleName: string;
      domOrder: number;
      target: boolean;
    }> = [];
    let record: FocusAuditRecord | null = null;
    for (let step = 1; step <= 64; step += 1) {
      await page.keyboard.press(key);
      const active = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const all = Array.from(document.querySelectorAll("*"));
        return {
          step: 0,
          tag: element?.tagName.toLowerCase() ?? null,
          accessibleName: element?.getAttribute("aria-label") || element?.innerText.trim() || "",
          domOrder: element ? all.indexOf(element) : -1,
          target: element?.hasAttribute("data-floating-primary") ?? false,
        };
      });
      activeElements.push({ ...active, step });
      if (!active.target) {
        // Tabbing can scroll the in-flow primary back into view before the
        // floating mirror's later DOM position is reached. Restore the same
        // floating product state without changing focus, then continue the
        // real keyboard traversal.
        await scrollShell(page, "bottom");
        await expect(target).toBeVisible();
        continue;
      }
      await page.evaluate((item) => {
        const control = document.activeElement as HTMLElement | null;
        if (!control?.hasAttribute("data-floating-primary")) {
          throw new Error("active element stopped being the floating CTA before audit");
        }
        control.dataset.focusAuditId = item.id;
        control.dataset.focusAuditName = item.accessibleName;
        control.dataset.focusAuditRole = item.role;
      }, inventory.enabled[0]);
      record = await auditFocusedControl(page);
      break;
    }
    expect(record, `${state} ${key} must reach the floating CTA from body origin`).not.toBeNull();
    if (!record) throw new Error(`${state} ${key} did not reach the floating CTA`);
    expectThreePixelFocus({ ...record, disabled: false, floating: true, latest: false });
    expect(record.focusVisible).toBe(true);
    expect(record.textContrast).toBeGreaterThanOrEqual(4.5);
    expect(record.outlineContrast).toBeGreaterThanOrEqual(3);
    expect(record.accessibleName).toBe(inventory.enabled[0].accessibleName);
    expect(record.role).toBe(inventory.enabled[0].role);
    expect(record.domOrder).toBe(inventory.enabled[0].domOrder);
    const screenshot = await page.screenshot({ fullPage: true, caret: "initial" });
    const direction = key === "Tab" ? "forward-tab" : "reverse-shift-tab";
    await testInfo.attach(`browser-screenshot:${artifactLabel}-${direction}`, { body: screenshot, contentType: "image/png" });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-${artifactLabel}-${direction}.png`), screenshot);
    return {
      records: [record],
      sequence: [record.id],
      closure: "body-origin-target" as const,
      activeElements,
      activeElement: activeElements.at(-1) ?? null,
    };
  };
  const forward = await traverse("Tab");
  const reverse = await traverse("Shift+Tab");
  return { state, inventory, forward, reverse };
}

test.describe("Global Meeting translation — real browser", () => {
  test("brand contract, five honest states, exact responsive geometry, focus/contrast, and deterministic network recovery", async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: "expected-network-failure-console",
      description: "temporary-key-http-503",
    });
    const { temporaryKeyCalls, networkEvents } = await installHarness(page, {
      temporaryKeyFailures: 1,
      temporaryKeyDelayMs: 150,
      temporaryKeyFailureMode: "http-503",
    });
    await page.goto(LIVE_URL);

    await expect(page.getByRole("row", { name: "대화 없음" })).toContainText("입력 발화가 여기에 이어집니다.");
    await expect(inFlowStart(page)).toBeEnabled();
    if (testInfo.project.name === "mobile-360") {
      await expect(page.locator("[data-floating-primary]")).toBeVisible();
      const geometry = await floatingTranscriptGeometry(page);
      const geometryBody = Buffer.from(JSON.stringify(geometry, null, 2));
      await testInfo.attach("raw-dom-geometry:initial-floating-vs-transcript", {
        body: geometryBody,
        contentType: "application/json",
      });
      await mkdir(EVIDENCE_DIR, { recursive: true });
      await writeFile(join(EVIDENCE_DIR, "mobile-360-initial-floating-transcript-geometry.json"), geometryBody);
      expect(geometry.viewport.width).toBe(360);
      expect(geometry.containerOverlap.area).toBe(0);
      expect(geometry.childOverlapArea).toBe(0);
      expect(geometry.childOverlapRectCount).toBe(0);
      expect(geometry.overlapArea).toBe(0);
      expect(geometry.overlapRectCount).toBe(0);
      expect(geometry.unreadableRectCount).toBe(0);
      expect(geometry.clipping).toBe(0);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    }
    await saveShot(page, testInfo, "states-before-empty");

    await inFlowStart(page).click();
    await expect(page.getByRole("status", { name: "Push-to-Talk 상태" })).toContainText(/확인하는 중|연결하는 중/);
    await expect(page.getByRole("combobox", { name: "내 언어" })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "실시간 번역을 시작하지 못했습니다." }))
      .toContainText(/시작하지 못했습니다.*다시/);
    await expect(inFlowStart(page)).toBeEnabled();

    await inFlowStart(page).click();
    await expect(page.getByRole("status", { name: "Push-to-Talk 상태" })).toContainText("연결되었습니다");
    expect(temporaryKeyCalls.count).toBe(2);
    const networkEvidenceBody = Buffer.from(JSON.stringify({
      temporaryKeyCalls: temporaryKeyCalls.count,
      networkEvents,
      uiTransitions: ["idle", "connecting", "honest-error", "retry", "connected"],
    }, null, 2));
    await testInfo.attach("raw-network-events:failure-retry-recovery", {
      body: networkEvidenceBody,
      contentType: "application/json",
    });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-network-failure-recovery.json`), networkEvidenceBody);
    expect(networkEvents.filter((event) => event.type === "response" && event.status === 503)).toHaveLength(1);
    expect(networkEvents.filter((event) => event.type === "requestfailed")).toHaveLength(0);
    expect(networkEvents.filter((event) =>
      event.type === "response" && event.method === "POST" && event.status === 200
    )).toHaveLength(1);

    const geometry = await page.evaluate(() => {
      const controls = document.querySelector<HTMLElement>("[data-testid='global-meeting-controls']");
      const transcript = document.querySelector<HTMLElement>("[data-testid='global-meeting-transcript-scroll']");
      const elements = [controls, transcript].filter((item): item is HTMLElement => Boolean(item));
      return {
        viewportWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped: elements.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1;
        }).length,
        overlap: controls && transcript
          ? Math.max(0, Math.min(controls.getBoundingClientRect().bottom, transcript.getBoundingClientRect().bottom)
            - Math.max(controls.getBoundingClientRect().top, transcript.getBoundingClientRect().top))
          : 0,
      };
    });
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.clipped).toBe(0);
    expect(geometry.overlap).toBe(0);
    if (testInfo.project.name === "mobile-360") expect(geometry.viewportWidth).toBe(360);

    const startPtt = page.getByRole("button", { name: "송출 구간 시작" });
    await startPtt.focus();
    await expect(startPtt).toBeFocused();
    const styles = await startPtt.evaluate((element) => {
      const parseRgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [red, green, blue] = parseRgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const ratio = (foreground: string, background: string) => {
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const style = getComputedStyle(element);
      const surface = getComputedStyle(element.closest("[data-surface='settings']") as HTMLElement);
      const primary = getComputedStyle(document.querySelector("[data-surface='settings'] .ld-action-primary") as HTMLElement);
      return {
        color: style.color,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        secondaryContrast: ratio(style.color, surface.backgroundColor),
        primaryContrast: ratio(primary.color, primary.backgroundColor),
      };
    });
    expect(styles.color).not.toBe("rgb(0, 168, 114)");
    expect(styles.secondaryContrast).toBeGreaterThanOrEqual(4.5);
    expect(styles.primaryContrast).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThanOrEqual(3);
    expect(styles.outlineColor).not.toBe("rgba(0, 0, 0, 0)");

    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const darkStyles = await page.locator("[data-surface='settings'] .ld-action-primary").first().evaluate((element) => {
      const parseRgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [red, green, blue] = parseRgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const style = getComputedStyle(element);
      const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
      return {
        contrast: (values[0] + 0.05) / (values[1] + 0.05),
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
      };
    });
    await page.locator("[data-surface='settings'] .ld-action-primary").first().focus();
    const darkFocus = await page.locator("[data-surface='settings'] .ld-action-primary").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineColor: style.outlineColor, outlineWidth: style.outlineWidth };
    });
    expect(darkStyles.contrast).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(darkFocus.outlineWidth)).toBeGreaterThanOrEqual(3);
    expect(darkFocus.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });

    await saveShot(page, testInfo, "states-after-recovered");
  });

  test("every locale shows the exact Vision brand treatment and product name", async ({ page }) => {
    await installHarness(page);
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      await page.goto(LIVE_URL);
      await page.evaluate((value) => localStorage.setItem("ai-note-locale", value), locale);
      await page.reload();
      // Scope to the ONE home link visible at this viewport (desktop rail vs the
      // mobile top-bar are mutually hidden), then assert the exact Vision
      // treatment inside it — "Vision" wordmark + exact second line.
      const homeLink = page.locator('a[aria-label="Vision AI 미팅 에이전트 홈"]:visible');
      await expect(homeLink).toHaveCount(1);
      await expect(homeLink.getByText("Vision", { exact: true })).toBeVisible();
      await expect(homeLink.getByText("AI 미팅 에이전트(AI Meeting Agent)", { exact: true })).toBeVisible();
      expect(await page.title()).toBe("Vision AI 미팅 에이전트");
      // No legacy customer-facing product name survives on the shell.
      expect(await page.locator("body").innerText()).not.toContain("헤이홈");
    }
  });

  test("every reachable enabled meeting control is state-complete under forward and reverse Tab in light and dark", async ({ page }, testInfo) => {
    test.skip(!["desktop-1440", "mobile-360"].includes(testInfo.project.name), "Task scope requires desktop-1440 and exact mobile-360 focus matrices.");
    testInfo.annotations.push({
      type: "expected-network-failure-console",
      description: "temporary-key-http-503",
    });
    const originalViewport = page.viewportSize() ?? { width: 1440, height: 900 };
    const allEvidence: Array<{
      theme: "light" | "dark";
      states: Array<Awaited<ReturnType<typeof auditStateFocus>> | Awaited<ReturnType<typeof auditFloatingPrimaryFocus>>>;
    }> = [];
    for (const theme of ["light", "dark"] as const) {
      await page.unrouteAll({ behavior: "wait" });
      await installHarness(page, { temporaryKeyFailures: 1, temporaryKeyFailureMode: "http-503" });
      await page.goto(LIVE_URL);
      await page.evaluate((nextTheme) => { document.documentElement.dataset.theme = nextTheme; }, theme);
      await expect(page.getByTestId("global-meeting-controls")).toBeVisible();

      const states: Array<Awaited<ReturnType<typeof auditStateFocus>> | Awaited<ReturnType<typeof auditFloatingPrimaryFocus>>> = [];
      await inFlowStart(page).scrollIntoViewIfNeeded();
      await expect(page.locator("[data-floating-primary]")).toHaveCount(0);
      states.push(await auditStateFocus(page, "idle"));
      await page.setViewportSize({ width: originalViewport.width, height: 360 });
      await inFlowStart(page).scrollIntoViewIfNeeded();
      await scrollShell(page, "bottom");
      await expect(page.locator("[data-floating-primary]")).toBeVisible();
      states.push(await auditFloatingPrimaryFocus(page, testInfo, "idle-floating-cta", `${theme}-idle-floating-cta`));
      await page.setViewportSize(originalViewport);
      await inFlowStart(page).scrollIntoViewIfNeeded();

      await inFlowStart(page).click();
      await expect(page.getByRole("alert").filter({ hasText: "실시간 번역을 시작하지 못했습니다." })).toBeVisible();
      await inFlowStart(page).scrollIntoViewIfNeeded();
      await expect(page.locator("[data-floating-primary]")).toHaveCount(0);
      states.push(await auditStateFocus(page, "retry-error"));

      await inFlowStart(page).click();
      await expect(page.getByRole("status", { name: "Push-to-Talk 상태" })).toContainText("연결되었습니다");
      await expect(page.getByRole("button", { name: "송출 구간 시작" })).toBeEnabled();
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __ai_e2e?: { sentConfig?: unknown } }).__ai_e2e?.sentConfig)))
        .toBe(true);
      states.push(await auditStateFocus(page, "active-meeting"));

      for (let index = 0; index < 24; index += 1) {
        await emitUtterance(page, String((index % 2) + 1), `포커스 감사 발화 ${index}`, "ko", `Focus audit utterance ${index}`, "en");
      }
      const region = page.getByRole("region", { name: "대화 기록" });
      await expect.poll(() => region.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeGreaterThan(100);
      await region.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await expect.poll(() => region.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(48);
      await region.hover();
      await page.mouse.wheel(0, -4000);
      await expect(page.getByRole("button", { name: "최신 내용 보기" })).toBeVisible();
      states.push(await auditStateFocus(page, "latest-content"));

      await page.getByRole("button", { name: "미팅 종료" }).click();
      const dialog = page.getByRole("dialog", { name: "회의록 저장" });
      await expect(dialog).toBeVisible();
      states.push(await auditStateFocus(page, "save-dialog"));

      await dialog.getByRole("button", { name: "폐기하기" }).click();
      await expect(dialog.getByRole("button", { name: "폐기 확정" })).toBeVisible();
      states.push(await auditStateFocus(page, "discard-confirm-dialog"));
      await saveShot(page, testInfo, `state-complete-focus-${theme}`);
      await dialog.getByRole("button", { name: "폐기 확정" }).click();
      await expect(dialog).toBeHidden();
      allEvidence.push({ theme, states });
    }

    const body = Buffer.from(JSON.stringify({
      project: testInfo.project.name,
      viewport: page.viewportSize(),
      themes: allEvidence,
    }, null, 2));
    await testInfo.attach("raw-tab-focus-state-complete", { body, contentType: "application/json" });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-state-complete-tab-focus.json`), body);
  });

  test("Soniox config enables language ID with the selected target wired, and KO+EN utterances render with exact labels/columns", async ({ page }, testInfo) => {
    await installHarness(page);
    await page.goto(LIVE_URL);

    // AC2: exact top labels.
    await expect(page.getByRole("combobox", { name: "내 언어" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "상대방 언어" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "입력 언어" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "번역할 언어" })).toHaveCount(0);
    // AC3: exact column headers.
    await expect(page.getByRole("table", { name: "글로벌 미팅 번역 대화록" }).getByRole("columnheader"))
      .toHaveText(["입력", "번역"]);

    // AC7: SUIT 500/700 are real browser-loaded WOFF2 assets with a truthful MIME.
    const fontEvidence = await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('500 16px "SUIT"'),
        document.fonts.load('700 16px "SUIT"'),
      ]);
      const response = await fetch("/fonts/SUIT/SUIT-Medium.woff2");
      const signature = String.fromCharCode(...new Uint8Array((await response.arrayBuffer()).slice(0, 4)));
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        signature,
        mediumLoaded: document.fonts.check('500 16px "SUIT"'),
        boldLoaded: document.fonts.check('700 16px "SUIT"'),
        resourceLoaded: performance.getEntriesByType("resource")
          .some((entry) => entry.name.includes("/fonts/SUIT/SUIT-Medium.woff2")),
      };
    });
    expect(fontEvidence).toMatchObject({
      status: 200,
      signature: "wOF2",
      mediumLoaded: true,
      boldLoaded: true,
      resourceLoaded: true,
    });
    expect(fontEvidence.contentType).toMatch(/font\/woff2|application\/font-woff2/i);

    // Select a non-default target to prove the selection stays wired into the real config.
    await page.getByRole("combobox", { name: "상대방 언어" }).selectOption("ja");
    await startAndListen(page);

    const config = await page.evaluate(() => (window as unknown as { __ai_e2e: { sentConfig: Record<string, unknown> } }).__ai_e2e.sentConfig);
    expect(config.enable_language_identification).toBe(true);
    expect(config.translation).toMatchObject({ type: "two_way", language_a: "ko", language_b: "ja" });

    // Inject a Korean and an English utterance; both must render in the real UI.
    await emitUtterance(page, "1", "안녕하세요 회의를 시작합니다", "ko", "会議を始めます", "ja");
    await emitUtterance(page, "2", "Can everyone hear me clearly", "en", "みんな聞こえますか", "ja");

    const table = page.getByRole("table", { name: "글로벌 미팅 번역 대화록" });
    await expect(table.getByText("안녕하세요 회의를 시작합니다")).toBeVisible();
    await expect(table.getByText("Can everyone hear me clearly")).toBeVisible();

    expect(await noHorizontalOverflow(page)).toBe(true);
    await saveShot(page, testInfo, "ac1-ac3-utterances");
  });

  test("scroll owner follows at bottom, does not yank a reading user, and 최신 내용 보기 resumes follow", async ({ page }, testInfo) => {
    await installHarness(page);
    await page.goto(LIVE_URL);
    await startAndListen(page);

    // Fill past one viewport so the transcript region becomes the scroll owner.
    for (let i = 0; i < 24; i += 1) {
      await emitUtterance(page, i % 2 === 0 ? "1" : "2", `발화 원문 ${i} 입니다`, "ko", `Utterance number ${i}`, "en");
    }
    const region = page.getByRole("region", { name: "대화 기록" });
    const metrics = () => region.evaluate((el) => ({
      atBottom: el.scrollHeight - el.clientHeight - el.scrollTop <= 48,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    // AC5: at bottom, updates pin to newest content.
    await expect.poll(async () => (await metrics()).scrollHeight, { message: "region should overflow" })
      .toBeGreaterThan((await metrics()).clientHeight + 100);
    await expect.poll(async () => (await metrics()).atBottom).toBe(true);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);

    // AC6: user scrolls up (real wheel gesture) → user-reading; later updates must NOT yank down.
    await region.hover();
    await page.mouse.wheel(0, -4000);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toBeVisible();
    await emitUtterance(page, "1", "읽는 중에 도착한 새 발화", "ko", "Arrived while reading", "en");
    // Give the update a chance to (wrongly) scroll; assert it stayed put.
    await expect.poll(async () => (await metrics()).scrollTop).toBeLessThan(48);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toBeVisible();
    const ptt = page.getByRole("button", { name: "송출 구간 시작" });
    await ptt.focus();
    await page.keyboard.press("Tab");
    const latestFocus = await focusedControlSnapshot(page);
    expect(latestFocus.latest).toBe(true);
    expectThreePixelFocus(latestFocus);
    const latestFocusBody = Buffer.from(JSON.stringify({
      project: testInfo.project.name,
      control: latestFocus,
    }, null, 2));
    await testInfo.attach("raw-tab-focus:latest-content", {
      body: latestFocusBody,
      contentType: "application/json",
    });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-latest-tab-focus.json`), latestFocusBody);
    await saveShot(page, testInfo, "ac6-user-reading");

    // AC7: explicit resume returns to follow and jumps to bottom.
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await metrics()).atBottom).toBe(true);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);

    // AC7: subsequent updates stay pinned after resume.
    await emitUtterance(page, "2", "재개 후 새 발화", "ko", "New after resume", "en");
    await expect.poll(async () => (await metrics()).atBottom).toBe(true);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("floating primary CTA appears when the original scrolls out of view, invokes once, and hides when it returns", async ({ page }, testInfo) => {
    await installHarness(page);
    // Force the idle page to overflow on every project so the in-flow CTA can be
    // both scrolled into view and scrolled out of view deterministically. The
    // real-height exact-360 obstruction gate lives in the first test above.
    const size = page.viewportSize();
    await page.setViewportSize({ width: size?.width ?? 1440, height: 360 });
    await page.goto(LIVE_URL);

    const original = inFlowStart(page);
    const floating = page.locator("[data-floating-primary]");
    const shellHeight = () => page.evaluate(() => {
      const content = document.getElementById("app-content");
      return content && content.scrollHeight > content.clientHeight ? content.scrollHeight : document.body.scrollHeight;
    });

    // Bring the in-flow CTA into view → the floating mirror must be absent.
    await original.scrollIntoViewIfNeeded();
    await expect(floating).toHaveCount(0);
    const before = await shellHeight();

    // Scroll the in-flow CTA out of the viewport → floating mirror appears.
    await scrollShell(page, "bottom");
    await expect(floating).toBeVisible();
    await expect(floating).toHaveText("미팅 시작");
    // The floating action is pinned via its fixed wrapper (fixed overlay, no flow impact).
    expect(await floating.evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).position)).toBe("fixed");
    // No layout jump (fixed overlay does not change scrollable height) and no h-overflow.
    expect(await shellHeight()).toBe(before);
    expect(await noHorizontalOverflow(page)).toBe(true);
    const geometry = await floatingTranscriptGeometry(page);
    const geometryBody = Buffer.from(JSON.stringify(geometry, null, 2));
    await testInfo.attach("raw-dom-geometry:floating-vs-transcript", {
      body: geometryBody,
      contentType: "application/json",
    });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-floating-transcript-geometry.json`), geometryBody);
    if (testInfo.project.name === "mobile-360") expect(geometry.viewport.width).toBe(360);
    expect(geometry.containerOverlap.area).toBe(0);
    expect(geometry.childOverlapArea).toBe(0);
    expect(geometry.childOverlapRectCount).toBe(0);
    expect(geometry.overlapArea).toBe(0);
    expect(geometry.overlapRectCount).toBe(0);
    expect(geometry.unreadableRectCount).toBe(0);
    expect(geometry.clipping).toBe(0);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    await saveShot(page, testInfo, "ac8-floating-visible");

    // Hides again once the in-flow control returns to view.
    await original.scrollIntoViewIfNeeded();
    await expect(floating).toHaveCount(0);

    // Shares the handler and invokes exactly once.
    await scrollShell(page, "bottom");
    await expect(floating).toBeVisible();
    const startsBefore = await page.evaluate(() => (window as unknown as { __ai_e2e: { startCount: number } }).__ai_e2e.startCount);
    await floating.click();
    await expect(page.getByRole("button", { name: "미팅 종료" })).toBeVisible();
    const startsAfter = await page.evaluate(() => (window as unknown as { __ai_e2e: { startCount: number } }).__ai_e2e.startCount);
    expect(startsAfter - startsBefore).toBe(1);
  });

  test("stop → save dialog: 폐기하기 then 돌아가기 still saves through the stubbed endpoint (≥44px, focusable)", async ({ page }, testInfo) => {
    const { sessionCalls, deleteCalls } = await installHarness(page);
    await page.goto(LIVE_URL);
    await startAndListen(page);
    await emitUtterance(page, "1", "저장 분기 테스트 발화", "ko", "Save-branch utterance", "en");
    await expect(page.getByText("저장 분기 테스트 발화")).toBeVisible();

    await page.getByRole("button", { name: "미팅 종료" }).click();
    const dialog = page.getByRole("dialog", { name: "회의록 저장" });
    await expect(dialog).toBeVisible();
    const discard = dialog.getByRole("button", { name: "폐기하기" });
    await expect(discard).toBeVisible();
    // AC11: primary targets ≥44px and keyboard-focusable.
    const box = await discard.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await discard.focus();
    await expect(discard).toBeFocused();
    await saveShot(page, testInfo, "ac9-save-dialog");

    // Enter the confirmation, then back out — save must remain available and work.
    await discard.click();
    await expect(dialog.getByText(/되돌릴 수 없습니다/)).toBeVisible();
    await dialog.getByRole("button", { name: "돌아가기" }).click();
    await dialog.getByRole("button", { name: "회의록 저장" }).click();

    await expect(page.getByText(/저장했습니다/)).toBeVisible();
    expect(sessionCalls).toHaveLength(1);
    expect((sessionCalls[0].body as { transcript?: string }).transcript).toContain("저장 분기 테스트 발화");
    expect(deleteCalls).toHaveLength(0);
  });

  test("user-reading → stop → save → new meeting resets follow and gesture state without leaking prior session data", async ({ page }, testInfo) => {
    const { manualEditingMeetingForProject } = await fixtureModule;
    const seeded = manualEditingMeetingForProject(testInfo.project.name);
    const { sessionCalls, deleteCalls } = await installHarness(page);

    await page.goto("/");
    const seededLink = page.getByRole("link").filter({ hasText: seeded.title });
    await expect(seededLink).toHaveAttribute("href", `/meetings/${seeded.meetingId}`);

    await page.goto(LIVE_URL);
    await startAndListen(page);
    for (let i = 0; i < 24; i += 1) {
      await emitUtterance(page, String((i % 2) + 1), `저장 전 발화 ${i}`, "ko", `Before save ${i}`, "en");
    }
    const region = page.getByRole("region", { name: "대화 기록" });
    await region.hover();
    await page.mouse.wheel(0, -4000);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toBeVisible();

    await page.getByRole("button", { name: "미팅 종료" }).click();
    const dialog = page.getByRole("dialog", { name: "회의록 저장" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "회의록 저장" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/저장했습니다/)).toBeVisible();
    expect(sessionCalls).toHaveLength(1);
    expect((sessionCalls[0].body as { transcript?: string }).transcript).toContain("저장 전 발화 0");
    expect(deleteCalls).toHaveLength(0);

    await startAndListen(page);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);
    await expect(page.getByText("저장 전 발화 0")).toHaveCount(0);
    await emitUtterance(page, "1", "저장 후 새 회의 첫 발화", "ko", "First after save", "en");
    await emitUtterance(page, "2", "저장 후 새 회의 연속 발화", "ko", "Continuous after save", "en");
    await expect(page.getByText("저장 후 새 회의 연속 발화")).toBeVisible();
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);
    await expect.poll(() => region.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop <= 48
    ))).toBe(true);

    const raw = {
      project: testInfo.project.name,
      viewport: page.viewportSize(),
      latestCtaCount: await page.getByRole("button", { name: "최신 내용 보기" }).count(),
      priorSessionRowCount: await page.getByText("저장 전 발화 0").count(),
      firstNewRowCount: await page.getByText("저장 후 새 회의 첫 발화").count(),
      continuousNewRowCount: await page.getByText("저장 후 새 회의 연속 발화").count(),
      nearBottom: await region.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop <= 48),
      scroll: await region.evaluate((element) => ({
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      })),
      sessionSaveCalls: sessionCalls.length,
      deleteCalls: deleteCalls.length,
    };
    const body = Buffer.from(JSON.stringify(raw, null, 2));
    await testInfo.attach("raw-save-new-follow-reset", { body, contentType: "application/json" });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-save-new-follow-reset.json`), body);
    await saveShot(page, testInfo, "save-new-follow-reset");

    await page.getByRole("button", { name: "미팅 종료" }).click();
    const secondDialog = page.getByRole("dialog", { name: "회의록 저장" });
    await secondDialog.getByRole("button", { name: "폐기하기" }).click();
    await secondDialog.getByRole("button", { name: "폐기 확정" }).click();
    expect(sessionCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(0);

    await page.goto("/");
    const seededAfter = page.getByRole("link").filter({ hasText: seeded.title });
    await expect(seededAfter).toHaveAttribute("href", `/meetings/${seeded.meetingId}`);
  });

  test("user-reading → stop → discard → new meeting continuously follows without save/DELETE and preserves seeded data", async ({ page }, testInfo) => {
    const { manualEditingMeetingForProject } = await fixtureModule;
    const seeded = manualEditingMeetingForProject(testInfo.project.name);
    const { sessionCalls, deleteCalls } = await installHarness(page);

    // The seeded existing saved meeting is visible on Home before we discard.
    await page.goto("/");
    const seededLink = page.getByRole("link").filter({ hasText: seeded.title });
    await expect(seededLink).toHaveAttribute("href", `/meetings/${seeded.meetingId}`);

    await page.goto(LIVE_URL);
    await startAndListen(page);
    for (let i = 0; i < 24; i += 1) {
      await emitUtterance(page, String((i % 2) + 1), `폐기 전 발화 ${i}`, "ko", `Before discard ${i}`, "en");
    }
    const region = page.getByRole("region", { name: "대화 기록" });
    await region.hover();
    await page.mouse.wheel(0, -4000);
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toBeVisible();

    await page.getByRole("button", { name: "미팅 종료" }).click();
    const dialog = page.getByRole("dialog", { name: "회의록 저장" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "폐기하기" }).click();
    await expect(dialog.getByText(/저장된 다른 회의록에는 영향을 주지 않습니다/)).toBeVisible();
    await dialog.getByRole("button", { name: "폐기 확정" }).click();

    // Dialog closes, memory cleared (fresh start), conversation gone.
    await expect(dialog).toBeHidden();
    await expect(inFlowStart(page)).toBeVisible();
    await expect(page.getByText("폐기 전 발화 0")).toHaveCount(0);
    expect(sessionCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    await saveShot(page, testInfo, "ac10-after-discard");

    // The new session must forget the prior user-reading state and follow each
    // continuous transcript/translation update to the bottom.
    await startAndListen(page);
    await emitUtterance(page, "1", "새 회의 첫 발화", "ko", "New meeting first", "en");
    await emitUtterance(page, "2", "새 회의 연속 발화", "ko", "New meeting continuous", "en");
    await expect(page.getByText("새 회의 연속 발화")).toBeVisible();
    await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);
    await expect.poll(() => region.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop <= 48
    ))).toBe(true);

    const raw = await region.evaluate((element) => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      latestCtaCount: document.querySelectorAll('[data-testid="latest-content-cta"]').length,
      priorSessionRowCount: Array.from(document.querySelectorAll("tbody tr")).filter((row) => (
        row.textContent?.includes("폐기 전 발화 0")
      )).length,
      firstNewRowCount: Array.from(document.querySelectorAll("tbody tr")).filter((row) => (
        row.textContent?.includes("새 회의 첫 발화")
      )).length,
      continuousNewRowCount: Array.from(document.querySelectorAll("tbody tr")).filter((row) => (
        row.textContent?.includes("새 회의 연속 발화")
      )).length,
      nearBottom: element.scrollHeight - element.clientHeight - element.scrollTop <= 48,
      scroll: {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      },
    }));
    const discardEvidence = {
      project: testInfo.project.name,
      ...raw,
      sessionSaveCalls: sessionCalls.length,
      deleteCalls: deleteCalls.length,
    };
    const body = Buffer.from(JSON.stringify(discardEvidence, null, 2));
    await testInfo.attach("raw-discard-new-follow-reset", { body, contentType: "application/json" });
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, `${testInfo.project.name}-discard-new-follow-reset.json`), body);
    await saveShot(page, testInfo, "discard-new-follow-reset");

    // End and discard this second synthetic draft too so navigation remains safe.
    await page.getByRole("button", { name: "미팅 종료" }).click();
    const secondDialog = page.getByRole("dialog", { name: "회의록 저장" });
    await secondDialog.getByRole("button", { name: "폐기하기" }).click();
    await secondDialog.getByRole("button", { name: "폐기 확정" }).click();
    expect(sessionCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);

    // The seeded saved meeting is still present and unchanged on Home.
    await page.goto("/");
    const seededAfter = page.getByRole("link").filter({ hasText: seeded.title });
    await expect(seededAfter).toHaveAttribute("href", `/meetings/${seeded.meetingId}`);
    expect(sessionCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  for (const localeCase of [
    {
      locale: "en",
      latest: "View latest",
      discard: "Discard",
      confirmTitle: "Discard this meeting?",
      back: "Go back",
      confirm: "Confirm discard",
    },
    {
      locale: "ja",
      latest: "最新の内容を見る",
      discard: "破棄する",
      confirmTitle: "このミーティングを破棄しますか？",
      back: "戻る",
      confirm: "破棄を確定",
    },
    {
      locale: "zh",
      latest: "查看最新内容",
      discard: "丢弃",
      confirmTitle: "要丢弃这场会议吗？",
      back: "返回",
      confirm: "确认丢弃",
    },
  ] as const) {
    test(`${localeCase.locale} localizes latest-content and discard dynamic UI without Korean residue`, async ({ page }, testInfo) => {
      await installHarness(page);
      await page.addInitScript((locale) => localStorage.setItem("ai-note-locale", locale), localeCase.locale);
      await page.goto(LIVE_URL);

      const controls = page.getByTestId("global-meeting-controls");
      await controls.locator("button:not([data-floating-primary])").first().click();
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __ai_e2e?: { sentConfig?: unknown } }).__ai_e2e?.sentConfig))).toBe(true);
      for (let i = 0; i < 24; i += 1) {
        await emitUtterance(page, String((i % 2) + 1), `Source ${i}`, "en", `Translation ${i}`, "ja");
      }

      const region = page.getByRole("region").filter({ has: page.getByRole("table") });
      await region.hover();
      await page.mouse.wheel(0, -4000);
      await expect(page.getByRole("button", { name: localeCase.latest })).toBeVisible();
      await expect(page.getByRole("button", { name: "최신 내용 보기" })).toHaveCount(0);

      await controls.locator("button:not([data-floating-primary])").nth(1).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog.getByRole("button", { name: localeCase.discard })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "폐기하기" })).toHaveCount(0);
      await dialog.getByRole("button", { name: localeCase.discard }).click();
      await expect(dialog.getByText(localeCase.confirmTitle)).toBeVisible();
      await expect(dialog.getByRole("button", { name: localeCase.back })).toBeVisible();
      await expect(dialog.getByRole("button", { name: localeCase.confirm })).toBeVisible();
      await expect(dialog.getByText("이 회의를 폐기할까요?")).toHaveCount(0);
      await saveShot(page, testInfo, `locale-${localeCase.locale}-dynamic-ui`);
    });
  }
});
