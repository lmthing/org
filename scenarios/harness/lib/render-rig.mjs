/**
 * render-rig.mjs — the LAYOUT gate. The one gate that can see a page that renders NOTHING.
 *
 * ## Why this exists
 *
 * The first model-generated view-spec app rendered **completely blank on every page**, and passed
 * every gate in the system. The mechanism (fixed in `ce96a7bd`): the shell's root `Col` sized to its
 * content — **98px**, exactly the top bar (56) plus the assistant strip (42) — because its parent
 * chain is `display: contents` over a `display: block` mount div, and a block box is not a flex
 * container, so `flexGrow: 1` had nothing to grow inside. Every descendant then divided zero: the
 * Row 0, the inner Col 0, and the scroll container ended up **`clientHeight: 0` wrapping
 * `scrollHeight: 719`**. The first list row's action buttons landed at **`y: -107`** — present in the
 * DOM, present in the a11y tree, and completely unreachable.
 *
 * Every existing gate said the app was fine, and each was right about its own question:
 *
 *  - `buildApp` compiled it — it is valid TypeScript;
 *  - `validateAppViews` found 0 problems — every name resolves and every binding is contract-valid;
 *  - `renderSmokeViews` mounted all four pages with zero findings — it uses `renderToStaticMarkup`,
 *    so there is **no DOM, no CSS and no layout engine**; it is structurally incapable of seeing a
 *    box with the wrong height (said plainly in `libs/cli/src/app/view-spec/validate.ts`, `777b7abb`);
 *  - the a11y snapshot happily listed all four plants — the nodes exist, they are just 0px tall.
 *
 * Only a screenshot told the truth. So this module drives a **real browser with a real layout
 * engine**, and asks the only questions the others cannot: is anything actually painted, does the
 * scroller have a height, and can a user reach the buttons.
 *
 * ## Zero dependency, on purpose
 *
 * No puppeteer, no puppeteer-core, nothing added to any `package.json`. Node here is ≥ 24 and has a
 * **native global `WebSocket`**, which is the entire reason this is possible: we spawn the system
 * browser with `--remote-debugging-port=0`, read the real port out of the `DevTools listening on
 * ws://…` line it writes to **stderr**, ask `/json/list` for a target's `webSocketDebuggerUrl`, and
 * speak the Chrome DevTools Protocol down a plain `WebSocket`. `Page.captureScreenshot` returns
 * base64 which Node writes with `fs`.
 *
 * **SNAP CONFINEMENT (already hit twice, do not undo).** A snap-packaged Chromium cannot write
 * outside `$HOME`, and cannot write to hidden dirs inside it either — `--user-data-dir=/tmp/…` and
 * `~/.cache/…` both fail with *"Chromium cannot read and write to its data directory"*. So the
 * profile dir defaults under `~/snap/chromium/common/`, and screenshots NEVER go through a
 * browser-side path: they come back over CDP as base64 and are written by Node, which sidesteps the
 * confinement entirely and lets `screenshotDir` be anywhere (a run dir, `/tmp`, wherever). Second
 * half of the same lesson: a snap-launched browser **cannot be killed by signal** (`EACCES`, even as
 * its owner) — `Browser.close` over CDP is the only reliable shutdown. Both paths are exercised: this
 * rig runs clean on `/opt/google/chrome/chrome` and on `/snap/bin/chromium`.
 *
 * ## The honesty rules, which matter more here than coverage
 *
 * A gate that reports `0` when it could not run is worse than no gate: a zero reads as *clean*, and
 * that exact inversion is how the blank app shipped green. Therefore:
 *
 *  - every check is an object with `measured: true|false`; when `false` it carries a **`reason`** and
 *    its verdict field is **`null`**, never `0` and never `false`;
 *  - if the browser cannot be launched at all, the whole report is `{ unavailable: true, reason }`
 *    with `ok: null` — never an empty pass;
 *  - a browser-side exception is captured (`snapshot.error`) and turns the page's checks into
 *    `measured: false` with that message, so a thrown probe can never read as "no findings".
 *
 * ## Shape
 *
 * `renderCheck({ baseUrl, routes, viewports, screenshotDir })` → plain data, `JSON.stringify`-able,
 * with `findings` shaped exactly like `libs/cli/src/app/view-spec/messages.ts#ViewError`
 * (`{ code, path, message, severity, file? }`) so they merge into the same lists the other two gates
 * fill. Every route runs at **two viewports** — desktop 1280×900 and phone 390×844 — because the
 * phone layout is a different archetype (the nav relocates to a bottom tab bar) and fails
 * independently.
 *
 * ## Proving the gate can fail
 *
 * {@link SHELL_COLLAPSE_INJECTION} reproduces `ce96a7bd` in the browser (it puts `height: auto` back
 * on the shell root before first paint) and {@link renderRigSelfTest} runs the rig twice — once
 * clean, once injected — and asserts the verdict FLIPS. A gate never demonstrated to fail on its own
 * known-bad case is worthless; this repo has been bitten repeatedly by gates that were green because
 * they never ran. `node scenarios/harness/lib/render-rig.mjs --self-test <baseUrl> <route>`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { productConstants, servedPath } from './view-facts.mjs';

// ── browser discovery ───────────────────────────────────────────────────────────────────────────

/**
 * Where a headless Chrome/Chromium might be, best first.
 *
 * A non-snap build is preferred purely because it is unconfined (its profile can live anywhere and
 * `kill` behaves normally); the snap build works fine through the workarounds documented above, so it
 * is a legitimate fallback rather than a degraded one. Override with `LM_CHROME`.
 */
export const BROWSER_CANDIDATES = [
  process.env.LM_CHROME,
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

/** The first candidate that exists, or `null` (which becomes `unavailable`, never a pass). */
export function findBrowser(candidates = BROWSER_CANDIDATES) {
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* unreadable path — try the next */
    }
  }
  return null;
}

/**
 * Where per-launch profile dirs are made. A snap binary is confined to `$HOME` and cannot use hidden
 * dirs (so not `/tmp`, not `~/.cache`) — see the module docblock.
 */
export const PROFILE_BASE = join(homedir(), 'snap', 'chromium', 'common', 'lmthing-render-rig');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch the browser headless and return `{ binary, port, kill() }`.
 *
 * `--remote-debugging-port=0` then reading the port back off stderr is the only race-free way to get
 * a port: picking one ourselves loses to any concurrent rig (and this repo runs several agents at
 * once). Detached so the whole process tree is one killable group.
 *
 * @throws {Error} if no binary exists or the DevTools line never appears — the caller turns that
 *   into `{ unavailable: true, reason }`.
 */
export async function launchBrowser({ binary = null, profileDir = null, timeoutMs = 20_000, extraArgs = [] } = {}) {
  const bin = binary ?? findBrowser();
  if (!bin) throw new Error(`no Chrome/Chromium found (looked in: ${BROWSER_CANDIDATES.join(', ')}; set LM_CHROME)`);
  // A FRESH profile per launch, always. A shared one breaks two ways, both observed here: a leftover
  // browser holding the SingletonLock makes the next launch die on boot, and pointing two different
  // Chrome builds (`/opt/google/chrome` then `/snap/bin/chromium`) at one profile migrates it into a
  // state the other refuses — after which every run reported `unavailable`, on a perfectly good app,
  // until the dir was deleted. It also removes any contention between concurrent rigs, which matters:
  // several agents run in this checkout at once.
  const ephemeral = profileDir === null;
  try {
    mkdirSync(ephemeral ? PROFILE_BASE : profileDir, { recursive: true });
    if (ephemeral) profileDir = mkdtempSync(join(PROFILE_BASE, 'p-'));
  } catch {
    profileDir = profileDir ?? PROFILE_BASE; // the browser will say so in its own words if unusable
  }
  const child = spawn(
    bin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );

  let stderr = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`browser never printed a DevTools port in ${timeoutMs}ms; stderr: ${stderr.slice(-600)}`)), timeoutMs);
    const done = (fn, arg) => {
      clearTimeout(timer);
      fn(arg);
    };
    child.stderr.on('data', (d) => {
      stderr += d;
      const m = /DevTools listening on ws:\/\/[^/]*:(\d+)\//.exec(stderr);
      if (m) done(resolve, Number(m[1]));
    });
    child.on('error', (e) => done(reject, e));
    child.on('exit', (code) => done(reject, new Error(`browser exited (${code}) before listening; stderr: ${stderr.slice(-600)}`)));
  });

  const kill = () => {
    // The negative pid targets the detached GROUP — the browser forks zygotes, renderers and a
    // crashpad handler, and killing only the parent leaves them behind.
    //
    // **A SNAP-LAUNCHED BROWSER CANNOT BE KILLED BY SIGNAL AT ALL** — `kill -9 <pid>` is *permission
    // denied* even from the owning user's own shell, because the process lives inside snap's
    // confinement. So `Browser.close` over CDP is not a nicety here, it is the ONLY reliable stop, and
    // `renderCheck` sends it before falling back to this. (Proved by leaking one: a probe that only
    // called `kill()` left a headless Chromium running for 17 minutes, and `Browser.close` was what
    // finally ended it.) This function is therefore best-effort cleanup, not the shutdown path.
    for (const target of [-child.pid, child.pid]) {
      try {
        process.kill(target, 'SIGKILL');
        break;
      } catch {
        /* try the plain pid, then give up quietly */
      }
    }
    if (ephemeral) {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* a stray profile dir is litter, not a failure */
      }
    }
  };
  return { binary: bin, port, pid: child.pid, profileDir, kill, stderrTail: () => stderr.slice(-2000) };
}

// ── the CDP client (one WebSocket, one page) ─────────────────────────────────────────────────────

/**
 * A minimal Chrome DevTools Protocol session over the native global `WebSocket`.
 *
 * Deliberately tiny: `send` (id-matched request/response), `on` (event subscription) and `close`.
 * Everything else in this module is built from those three. A CDP error result becomes a rejected
 * promise carrying the protocol message, so a mistyped method fails loudly instead of hanging.
 */
export class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this.#onMessage(ev));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }

  static async connect(webSocketDebuggerUrl, { timeoutMs = 15_000 } = {}) {
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP websocket did not open in ${timeoutMs}ms`)), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`CDP websocket failed to connect to ${webSocketDebuggerUrl}`));
      });
    });
    return new CdpSession(ws);
  }

  #onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
    } catch {
      return; // an unparseable frame is not a reason to take the run down
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP ${JSON.stringify(msg.error)}`));
      else resolve(msg.result ?? {});
      return;
    }
    for (const fn of this.listeners.get(msg.method) ?? []) {
      try {
        fn(msg.params ?? {});
      } catch {
        /* a listener must never break the socket */
      }
    }
  }

  /** One CDP command. Rejects on a protocol error or a timeout. */
  send(method, params = {}, { timeoutMs = 30_000 } = {}) {
    if (this.closed) return Promise.reject(new Error(`CDP session closed (${method})`));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Subscribe to a CDP event. Returns an unsubscribe function. */
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  /** Resolve when `method` next fires (or reject on timeout). */
  once(method, { timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (p) => {
        off();
        clearTimeout(timer);
        resolve(p);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`CDP event ${method} never fired within ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
    this.closed = true;
  }
}

/** `GET /json/list` → the first `page` target. Retried, because the port is open a beat early. */
async function firstPageTarget(port, { attempts = 40, everyMs = 150 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      const list = await res.json();
      const page = Array.isArray(list) ? list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) : null;
      if (page) return page;
      last = `no page target among ${Array.isArray(list) ? list.length : 0} targets`;
    } catch (e) {
      last = String(e?.message ?? e);
    }
    await sleep(everyMs);
  }
  throw new Error(`could not find a CDP page target on port ${port}: ${last}`);
}

/**
 * Find a page target and connect to it, retrying BOTH halves.
 *
 * Chrome prints its `DevTools listening on…` line, and answers `/json/list`, a beat before the page
 * target's websocket handler is actually accepting — so a first connect can fail with nothing wrong.
 * Observed once in ~15 runs, and it presented as `unavailable: true` on a perfectly good app, which is
 * the honest outcome but a useless one. Re-querying `/json/list` on each attempt matters: the target
 * id can change if the browser swapped its initial tab.
 */
async function connectToPage(port, { attempts = 4, everyMs = 300 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const target = await firstPageTarget(port);
      return await CdpSession.connect(target.webSocketDebuggerUrl);
    } catch (e) {
      last = String(e?.message ?? e);
      await sleep(everyMs * (i + 1));
    }
  }
  throw new Error(`could not open a CDP session on port ${port} after ${attempts} attempts: ${last}`);
}

// ── viewports ───────────────────────────────────────────────────────────────────────────────────

/**
 * The two archetypes, and they are genuinely two.
 *
 * The phone layout is not the desktop one scaled: the nav relocates from a top bar to a bottom tab
 * bar, so a shell that lays out correctly at 1280 can collapse at 390 and vice versa. Both run for
 * every route, and a finding names which one it came from.
 */
export const VIEWPORTS = {
  desktop: { name: 'desktop', width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
  phone: { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};

export const DEFAULT_VIEWPORTS = [VIEWPORTS.desktop, VIEWPORTS.phone];

// ── the browser-side collector ──────────────────────────────────────────────────────────────────

/**
 * The ONE `Runtime.evaluate` per page: it collects a **serialisable snapshot** and computes no
 * verdicts. Every predicate lives in {@link analyzeSnapshot}, on the Node side, as a pure function —
 * which is what makes the blank/collapse logic unit-testable without a browser, and what stops a
 * silent browser-side bug from becoming "no findings".
 *
 * ### What it measures, and why each choice is the way it is
 *
 * **Painted content, by HIT TESTING, not by walking the DOM.** `document.elementFromPoint` respects
 * clipping, `display`, `visibility`, negative offsets, `overflow` and stacking order — so it answers
 * "what would a user actually see and be able to click", which is exactly the question the blank app
 * defeated. A DOM walk cannot: in the bug every node existed, carried its text and had a non-zero
 * rect; it was clipped inside a zero-height scroller. Measured on the real fixture: the healthy page
 * yields **31** text-bearing elements (four plant names, their rooms, eight buttons), the collapsed
 * one yields **5** — the brand, three nav labels and "Assistant".
 *
 * **Content is counted inside the CONTENT REGION**, not the whole viewport, so the shell chrome
 * (which paints perfectly well in the bug) cannot mask an empty page. The region is the largest
 * `overflow-y: auto|scroll` box — the shell's scroller, the thing that is supposed to hold the page.
 * With no such box we fall back to the mount root and SAY SO (`region.kind`), because a fallback that
 * is silent is a fallback that lies.
 *
 * **A `getClientRects().length === 0` element is skipped everywhere.** That is `display: none` — the
 * phone tab bar at desktop width is legitimately absent and must not read as an off-screen button.
 * The bug's buttons had real rects, so nothing real is lost by the filter.
 */
export const PAGE_SNAPSHOT_JS = String.raw`(() => {
  const GRID = 16;                       // px between hit-test samples
  const MAX_LIST = 12;                   // examples carried per category, so a report stays readable
  const clamp = (n) => Math.round(n * 10) / 10;
  const trunc = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const desc = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join(' ') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls.replace(/\s+/g, '.') : '');
  };
  const ownText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += ' ' + n.textContent;
    return t.replace(/\s+/g, ' ').trim();
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: clamp(r.x), y: clamp(r.y), w: clamp(r.width), h: clamp(r.height) };
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const de = document.documentElement;

  // ── every scroll container, with the two numbers that are the bug's fingerprint ──────────────
  const scrollers = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY)) continue;
    scrollers.push({
      desc: desc(el),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      rect: rectOf(el),
      laidOut: el.getClientRects().length > 0,
    });
  }

  // ── the content region: the biggest scroller, else the mount root (and say which) ────────────
  let regionEl = null;
  let regionKind = 'none';
  const byArea = [...document.querySelectorAll('*')]
    .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
    .map((el) => ({ el, area: el.clientWidth * el.clientHeight }))
    .sort((a, b) => b.area - a.area);
  if (byArea.length) {
    regionEl = byArea[0].el;
    regionKind = 'scroller';
  } else {
    regionEl = document.getElementById('root') || document.body;
    regionKind = regionEl ? 'mount' : 'none';
  }
  const regionRect = regionEl ? rectOf(regionEl) : { x: 0, y: 0, w: 0, h: 0 };
  const box = regionEl
    ? {
        left: Math.max(0, regionRect.x),
        top: Math.max(0, regionRect.y),
        right: Math.min(vw, regionRect.x + Math.min(regionRect.w, regionEl.clientWidth || regionRect.w)),
        bottom: Math.min(vh, regionRect.y + Math.min(regionRect.h, regionEl.clientHeight || regionRect.h)),
      }
    : { left: 0, top: 0, right: 0, bottom: 0 };

  // ── hit-test the region on a grid: what is ACTUALLY painted there ────────────────────────────
  const hits = new Set();
  let samples = 0;
  for (let y = box.top + 2; y < box.bottom; y += GRID) {
    for (let x = box.left + 2; x < box.right; x += GRID) {
      samples++;
      const el = document.elementFromPoint(x, y);
      if (el) hits.add(el);
    }
  }
  const texts = [];
  for (const el of hits) {
    const t = ownText(el);
    if (t) texts.push(t);
  }
  // Whole-viewport counterpart, so a report can show that the CHROME painted while the page did not
  // (which is precisely what a blank page looks like).
  const vpHits = new Set();
  for (let y = 2; y < vh; y += GRID) for (let x = 2; x < vw; x += GRID) {
    const el = document.elementFromPoint(x, y);
    if (el) vpHits.add(el);
  }
  let vpTextCount = 0;
  for (const el of vpHits) if (ownText(el)) vpTextCount++;

  // ── interactive elements: laid out, but can a user reach them? ───────────────────────────────
  const interactive = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"]')) {
    if (el.getClientRects().length === 0) continue;             // display:none — legitimately absent
    const r = rectOf(el);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const centerInView = cx >= 0 && cx < vw && cy >= 0 && cy < vh;
    let reachable = null;                                       // null = not asked (center off-screen)
    if (centerInView && r.w > 0 && r.h > 0) {
      const hit = document.elementFromPoint(cx, cy);
      // The element itself, or a DESCENDANT of it (a label span inside the button), means reachable. An
      // ANCESTOR does NOT: the point is inside the button's rect, so getting the ancestor back means
      // the button is not painted there — clipped by a zero-height scroller, covered, or
      // pointer-events:none. Counting an ancestor as reachable is exactly the leniency that let the
      // collapsed shell report 0 unusable buttons on a page where none of them could be clicked.
      reachable = !!hit && (hit === el || el.contains(hit));
    }
    interactive.push({
      desc: desc(el),
      text: trunc((el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), 28),
      rect: r,
      centerInView,
      reachable,
    });
  }

  // ── form controls (the Wave-2 "Nothing to fill in." bug) ─────────────────────────────────────
  const CONTROLS = 'input:not([type="submit"]):not([type="hidden"]), textarea, select, [contenteditable="true"], [role="switch"], [role="combobox"], [role="textbox"]';
  const controls = [...document.querySelectorAll(CONTROLS)].filter((el) => el.getClientRects().length > 0);

  return {
    viewport: { width: vw, height: vh },
    url: location.href,
    title: document.title,
    scrollers,
    region: { kind: regionKind, desc: regionEl ? desc(regionEl) : null, rect: regionRect, box, samples },
    content: { textElements: texts.length, elements: hits.size, texts: texts.slice(0, MAX_LIST), chars: texts.join(' ').length },
    viewportContent: { textElements: vpTextCount, elements: vpHits.size },
    interactive,
    controls: controls.length,
    bodyTextChars: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().length,
    horizontal: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth },
    injection: window.__RIG_INJECTION__ ?? null,
  };
})()`;

/** Run {@link PAGE_SNAPSHOT_JS} and return `{...snapshot}` or `{ error }` — never a throw. */
async function collectSnapshot(cdp) {
  try {
    const res = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify(${PAGE_SNAPSHOT_JS})`,
      returnByValue: true,
      awaitPromise: false,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      return { error: `browser-side probe threw: ${d.exception?.description ?? d.text ?? 'unknown'}` };
    }
    const raw = res.result?.value;
    if (typeof raw !== 'string') return { error: `browser-side probe returned ${typeof raw}, expected a JSON string` };
    return JSON.parse(raw);
  } catch (e) {
    return { error: `probe evaluate failed: ${String(e?.message ?? e)}` };
  }
}

// ── the PURE analysis (no browser, no I/O — this is the unit-tested half) ────────────────────────

const unmeasured = (reason) => ({ measured: false, reason });

/** A `ViewError`-shaped finding. Same five keys, same meanings, so these merge into the same lists. */
export function finding({ code, message, severity = 'error', file = undefined, path = '', route, viewport }) {
  const f = { code, path, message, severity };
  if (file) f.file = file;
  if (route !== undefined) f.route = route;
  if (viewport !== undefined) f.viewport = viewport;
  return f;
}

/** `plants/[id]` → `pages/plants/[id].view.json` — the artifact a finding is filed against. */
export function specFileFor(route) {
  return `pages/${route}${route.endsWith('.view.json') ? '' : '.view.json'}`;
}

/**
 * Below this many painted text elements in the content region, a page is BLANK.
 *
 * `0` and not a fuzzy threshold, deliberately: an empty list still paints its empty-state text, a
 * failed section still paints its error state, and both are pages that *work*. Zero painted text in
 * the whole content region means the user is looking at nothing, which is the only claim this check
 * is willing to make. (For calibration: the fixture's healthy page paints 31, the collapsed one 0 in
 * the region and 5 in the whole viewport — all of it chrome.)
 */
export const BLANK_TEXT_ELEMENTS = 0;

/**
 * Every verdict, computed from one serialisable snapshot. **Pure** — no browser, no fs, no clock.
 *
 * @param {object} snapshot            {@link PAGE_SNAPSHOT_JS}'s output, or `{ error }`
 * @param {object} ctx
 * @param {string} ctx.route           authoring route (`plants/[id]`) — the finding's `file`
 * @param {string} ctx.viewport        `'desktop'` | `'phone'`
 * @param {boolean} [ctx.expectsForm]  the page should render a form (a `create` page)
 * @param {string|null} [ctx.emptyFormSentinel]  the product's own "no fields" string, or `null`
 * @param {string|null} [ctx.bodyText] the page's text, for the sentinel search
 * @param {Array} [ctx.consoleErrors]  collected console/log/network errors (reported, never fatal)
 * @returns {{page: object, findings: Array}}
 */
export function analyzeSnapshot(snapshot, ctx = {}) {
  const { route = '?', viewport = '?', expectsForm = false, emptyFormSentinel = null, bodyText = null, consoleErrors = [] } = ctx;
  const file = specFileFor(route);
  const at = `${route} @ ${viewport}`;
  const findings = [];
  const mk = (code, message, severity = 'error') => {
    const f = finding({ code, message, severity, file, route, viewport });
    findings.push(f);
    return f;
  };

  // A probe that could not run makes EVERY check unmeasured with the same reason. Not `0`: see the
  // module docblock — a zero here is how the blank app shipped green.
  if (!snapshot || snapshot.error) {
    const reason = snapshot?.error ?? 'no snapshot was collected';
    mk('render-error', `${at}: the layout probe could not run — ${reason}. Every layout check on this page is UNMEASURED, not clean.`);
    return {
      page: {
        route,
        viewport,
        measured: false,
        reason,
        blankPage: unmeasured(reason),
        collapsedScroller: unmeasured(reason),
        offscreenInteractive: unmeasured(reason),
        horizontalOverflow: unmeasured(reason),
        emptyForm: unmeasured(reason),
        consoleErrors: summariseConsole(consoleErrors),
      },
      findings,
    };
  }

  // ── blankPage ────────────────────────────────────────────────────────────────────────────────
  const region = snapshot.region ?? { kind: 'none', samples: 0 };
  const content = snapshot.content ?? { textElements: 0, elements: 0, texts: [] };
  const vpContent = snapshot.viewportContent ?? { textElements: null };
  let blankPage;
  if (region.kind === 'none') {
    blankPage = unmeasured('no content region: the page has neither a scroll container nor a mount root');
    mk('empty-render', `${at}: ${blankPage.reason} — the page painted no measurable region, so "is it blank" is UNMEASURED.`);
  } else if (region.samples === 0) {
    // A zero-area region is not an unmeasurable page — it IS the blank page, and the strongest form
    // of it: there is no space for content to be in.
    blankPage = {
      measured: true,
      blank: true,
      region: region.kind,
      regionDesc: region.desc,
      samples: 0,
      textElements: 0,
      viewportTextElements: vpContent.textElements ?? null,
      texts: [],
      reason: `the content region (${region.desc}) has zero area — ${JSON.stringify(region.rect)}`,
    };
    mk(
      'empty-render',
      `${at}: BLANK — the content region ${region.desc} has zero area (rect ${JSON.stringify(region.rect)}), so nothing can be painted in it. ` +
        `${vpContent.textElements ?? '?'} text elements painted in the whole viewport, all of it shell chrome. ` +
        `This is the ce96a7bd fingerprint: the shell root sized to its content, so every descendant divided zero.`,
    );
  } else {
    const blank = content.textElements <= BLANK_TEXT_ELEMENTS;
    blankPage = {
      measured: true,
      blank,
      region: region.kind,
      regionDesc: region.desc,
      samples: region.samples,
      textElements: content.textElements,
      elements: content.elements,
      textChars: content.chars ?? null,
      viewportTextElements: vpContent.textElements ?? null,
      texts: content.texts ?? [],
    };
    if (blank) {
      mk(
        'empty-render',
        `${at}: BLANK — ${region.samples} hit-test samples across the content region (${region.desc}) painted ` +
          `${content.textElements} text elements. ${vpContent.textElements ?? '?'} painted in the whole viewport, i.e. shell chrome only. ` +
          `The page mounted and served 200; a user sees nothing.`,
      );
    }
  }

  // ── collapsedScroller — the exact fingerprint of ce96a7bd ────────────────────────────────────
  let collapsedScroller;
  if (!Array.isArray(snapshot.scrollers)) {
    collapsedScroller = unmeasured('the probe returned no scroller list');
  } else {
    const offenders = snapshot.scrollers
      .filter((s) => s.clientHeight === 0 && s.scrollHeight > 0)
      .map((s) => ({ desc: s.desc, clientHeight: s.clientHeight, scrollHeight: s.scrollHeight, rect: s.rect }));
    collapsedScroller = { measured: true, collapsed: offenders.length > 0, total: snapshot.scrollers.length, offenders };
    for (const o of offenders) {
      mk(
        'collapsed-scroller',
        `${at}: ${o.desc} has overflow-y auto/scroll with clientHeight ${o.clientHeight} wrapping scrollHeight ${o.scrollHeight} — ` +
          `it clips 100% of its content and cannot be scrolled. Almost always the SHELL, not this page: check pages/_shell.view.json ` +
          `and the height chain in libs/ui/src/view (a flexGrow with no definite height above it collapses to its content).`,
      );
    }
  }

  // ── offscreenInteractive ─────────────────────────────────────────────────────────────────────
  let offscreenInteractive;
  if (!Array.isArray(snapshot.interactive)) {
    offscreenInteractive = unmeasured('the probe returned no interactive-element list');
  } else {
    const items = snapshot.interactive;
    const brief = (i) => ({ desc: i.desc, text: i.text, ...i.rect });
    const offscreen = items.filter((i) => i.rect.y + i.rect.h <= 0 || i.rect.x + i.rect.w <= 0).map(brief);
    const zeroArea = items.filter((i) => i.rect.w <= 0 || i.rect.h <= 0).map(brief);
    // `reachable === false` is the class the blank app produced: a real rect inside the viewport that
    // hit-tests to something else, because a zero-height ancestor clips it away.
    const unreachable = items.filter((i) => i.reachable === false).map(brief);
    const belowFold = items.filter((i) => !i.centerInView).length; // legitimate: scrolled out of view
    const bad = offscreen.length + zeroArea.length + unreachable.length;
    offscreenInteractive = {
      measured: true,
      total: items.length,
      unusable: bad,
      offscreen,
      zeroArea,
      unreachable,
      belowFold,
      examples: [...offscreen, ...zeroArea, ...unreachable].slice(0, 4),
    };
    if (bad > 0) {
      const ex = offscreenInteractive.examples.map((e) => `${e.text || e.desc} at (${e.x}, ${e.y}) ${e.w}×${e.h}`).join('; ');
      mk(
        'offscreen-interactive',
        `${at}: ${bad} of ${items.length} interactive elements are laid out but unusable ` +
          `(${offscreen.length} above/left of the viewport, ${zeroArea.length} zero-area, ${unreachable.length} clipped or covered so a click at their centre lands elsewhere). ` +
          `Examples: ${ex}. They exist in the DOM and in the a11y tree, which is why no other gate sees them.`,
      );
    }
  }

  // ── horizontalOverflow — the body must never scroll sideways ─────────────────────────────────
  let horizontalOverflow;
  const h = snapshot.horizontal;
  if (!h || typeof h.scrollWidth !== 'number' || typeof h.clientWidth !== 'number') {
    horizontalOverflow = unmeasured('the probe returned no documentElement width pair');
  } else {
    const overflows = h.scrollWidth > h.clientWidth + 1;
    horizontalOverflow = { measured: true, overflows, scrollWidth: h.scrollWidth, clientWidth: h.clientWidth, by: h.scrollWidth - h.clientWidth };
    if (overflows) {
      mk(
        'horizontal-overflow',
        `${at}: the page scrolls sideways — documentElement.scrollWidth ${h.scrollWidth} > clientWidth ${h.clientWidth} (by ${h.scrollWidth - h.clientWidth}px). ` +
          `Wide content (a table, a code block, a diagram) must scroll inside its own container, never the body.`,
      );
    }
  }

  // ── emptyForm — the Wave-2 "Nothing to fill in." bug, which appCheck passes cleanly ──────────
  let emptyForm;
  const controls = typeof snapshot.controls === 'number' ? snapshot.controls : null;
  if (!expectsForm) {
    emptyForm = { measured: true, applicable: false, empty: null, controls, reason: 'not a form page — no form was expected here' };
  } else if (emptyFormSentinel == null) {
    // The definitive signal is the renderer's OWN string, read out of libs/ui/src/view/form.tsx. A
    // harness carrying its own copy goes quietly green the day it is reworded, so when it cannot be
    // extracted the check is unmeasured rather than falling back to the control count alone.
    emptyForm = unmeasured('the renderer\'s empty-form sentinel could not be read out of libs/ui/src/view/form.tsx');
    mk('empty-form', `${at}: cannot tell whether the form is empty — ${emptyForm.reason}. UNMEASURED, not clean.`, 'warning');
  } else {
    const sentinelPresent = typeof bodyText === 'string' ? bodyText.includes(emptyFormSentinel) : null;
    const empty = sentinelPresent === true || (sentinelPresent === false && controls === 0);
    emptyForm = {
      measured: true,
      applicable: true,
      empty,
      controls,
      sentinel: emptyFormSentinel,
      sentinelPresent,
      basis: sentinelPresent === true ? 'sentinel' : 'control-count',
    };
    if (empty) {
      mk(
        'empty-form',
        `${at}: the create page renders ${controls ?? 0} form fields. ` +
          (sentinelPresent === true
            ? `The renderer is showing its own "${emptyFormSentinel}" state, so the mutation's Input schema derived ZERO fields — check that the endpoint manifest carries inputSchema for it. `
            : `No form control rendered at all, and the "${emptyFormSentinel}" state is NOT showing — so either the create section never mounted, or this URL did not resolve to this page (a dynamic sibling like plants/[id] can shadow a static plants/new in the served route table). ` +
              `What actually painted: ${JSON.stringify((snapshot.content?.texts ?? []).slice(0, 5))}. `) +
          `This page builds, serves 200, and gives the user nothing to fill in.`,
      );
    }
  }

  return {
    page: {
      route,
      viewport,
      measured: true,
      url: snapshot.url ?? null,
      title: snapshot.title ?? null,
      blankPage,
      collapsedScroller,
      offscreenInteractive,
      horizontalOverflow,
      emptyForm,
      consoleErrors: summariseConsole(consoleErrors),
      bodyTextChars: snapshot.bodyTextChars ?? null,
      ...(snapshot.injection ? { injection: snapshot.injection } : {}),
    },
    findings,
  };
}

/**
 * Console/log/network errors as DATA, not as a verdict.
 *
 * The plant-care fixture legitimately has one 500 (`dashboard-stats`) that `renderSmokeViews` already
 * reports and routes to the endpoint. Failing this rig on it would duplicate a finding another gate
 * owns and train people to ignore this one.
 */
export function summariseConsole(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    measured: true,
    total: list.length,
    console: list.filter((e) => e.source === 'console').length,
    log: list.filter((e) => e.source === 'log').length,
    network: list.filter((e) => e.source === 'network').length,
    entries: list.slice(0, 10),
  };
}

// ── route → URL ─────────────────────────────────────────────────────────────────────────────────

/**
 * `{ route: 'plants/[id]', params: { id: 'abc' } }` → `/app/plant-care/plants/abc`.
 *
 * A parameterised route with no value supplied is **skipped with a reason** rather than fetched with
 * a made-up id: `renderSmokeViews`' global param pool already taught this repo that handing a detail
 * page another entity's id produces confident nonsense.
 */
export function routeUrl(baseUrl, entry) {
  const route = typeof entry === 'string' ? entry : entry.route;
  const params = (typeof entry === 'object' && entry?.params) || {};
  if (typeof entry === 'object' && entry?.url) return { route, url: entry.url.startsWith('http') ? entry.url : baseUrl.replace(/\/$/, '') + entry.url };
  const missing = [];
  const path = servedPath(route).replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    const v = params[name];
    if (v === undefined || v === null || v === '') {
      missing.push(name);
      return `:${name}`;
    }
    return encodeURIComponent(String(v));
  });
  if (missing.length) return { route, url: null, skip: `route parameter(s) ${missing.join(', ')} have no value — pass params:{${missing[0]}:'…'} to check this page` };
  return { route, url: baseUrl.replace(/\/$/, '') + (path === '/' ? '/' : path) };
}

/** A create/edit page is expected to render a form. Explicit `expectsForm` always wins. */
export function expectsFormFor(entry) {
  if (typeof entry === 'object' && entry?.expectsForm !== undefined) return !!entry.expectsForm;
  const route = typeof entry === 'string' ? entry : entry.route;
  const last = route.split('/').filter(Boolean).pop() ?? '';
  return last === 'new' || last === 'create' || last === 'edit';
}

/** `plants/[id]` @ phone → `phone__plants-id.png`. */
export function screenshotName(route, viewport) {
  const slug = route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'index';
  return `${viewport}__${slug}.png`;
}

// ── the rig ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Screenshot and layout-check every route at every viewport against a live server.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl             e.g. `http://localhost:45999/app/plant-care`
 * @param {Array<string|object>} opts.routes  authoring routes; `{route, params, expectsForm, url}` for detail pages
 * @param {Array<object>} [opts.viewports]  defaults to {@link DEFAULT_VIEWPORTS} (desktop + phone)
 * @param {string|null} [opts.screenshotDir]  written by NODE from base64, so any path is fine
 * @param {string|null} [opts.binary]       browser override (else {@link findBrowser})
 * @param {string|null} [opts.initScript]   injected before first paint — see {@link SHELL_COLLAPSE_INJECTION}
 * @param {number} [opts.settleMs]          quiet-network window before measuring
 * @returns {Promise<object>} `{ ok, unavailable?, reason?, browser, pages, findings, counts }`
 */
export async function renderCheck({
  baseUrl,
  routes,
  viewports = DEFAULT_VIEWPORTS,
  screenshotDir = null,
  binary = null,
  profileDir = null,
  initScript = null,
  settleMs = 600,
  settleTimeoutMs = 8000,
  navTimeoutMs = 30_000,
  sdkRoot = undefined,
} = {}) {
  const started = Date.now();
  const K = productConstants(sdkRoot ? { root: sdkRoot } : {});
  const base = {
    baseUrl,
    viewports: viewports.map((v) => v.name),
    routes: routes.map((r) => (typeof r === 'string' ? r : r.route)),
    emptyFormSentinel: K.emptyFormSentinel ?? null,
  };

  let browser;
  try {
    browser = await launchBrowser({ binary, profileDir });
  } catch (e) {
    // No browser ⇒ the WHOLE report is unavailable with a reason. Never an empty pass: an empty
    // `findings` array is indistinguishable from a clean run, and that is the inversion this module
    // exists to prevent.
    return { ...base, unavailable: true, reason: String(e?.message ?? e), ok: null, pages: [], findings: [], counts: null, ms: Date.now() - started };
  }

  if (screenshotDir) {
    try {
      mkdirSync(screenshotDir, { recursive: true });
    } catch (e) {
      screenshotDir = null;
      base.screenshotDirError = String(e?.message ?? e);
    }
  }

  const pages = [];
  const findings = [];
  let cdp = null;
  try {
    cdp = await connectToPage(browser.port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    // ── console / log / network collection, reset per page ─────────────────────────────────────
    let collected = [];
    let inflight = 0;
    let lastActivity = Date.now();
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'assert') return;
      collected.push({ source: 'console', level: p.type, text: (p.args ?? []).map((a) => a.description ?? a.value ?? a.type).join(' ').slice(0, 400) });
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry?.level !== 'error') return;
      collected.push({ source: 'log', level: 'error', text: String(p.entry.text ?? '').slice(0, 400), url: p.entry.url });
    });
    cdp.on('Network.requestWillBeSent', () => {
      inflight++;
      lastActivity = Date.now();
    });
    const settle = () => {
      inflight = Math.max(0, inflight - 1);
      lastActivity = Date.now();
    };
    cdp.on('Network.loadingFinished', settle);
    cdp.on('Network.loadingFailed', (p) => {
      settle();
      collected.push({ source: 'network', level: 'error', text: `request failed: ${p.errorText}`, canceled: !!p.canceled });
    });
    cdp.on('Network.responseReceived', (p) => {
      lastActivity = Date.now();
      const status = p.response?.status ?? 0;
      if (status >= 500) collected.push({ source: 'network', level: 'error', text: `HTTP ${status} ${p.response?.url ?? ''}`.slice(0, 400), status, url: p.response?.url });
    });

    if (initScript) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.deviceScaleFactor ?? 1,
        mobile: !!vp.mobile,
      });
      for (const entry of routes) {
        const { route, url, skip } = routeUrl(baseUrl, entry);
        if (skip) {
          const reason = skip;
          pages.push({
            route,
            viewport: vp.name,
            measured: false,
            skipped: true,
            reason,
            blankPage: unmeasured(reason),
            collapsedScroller: unmeasured(reason),
            offscreenInteractive: unmeasured(reason),
            horizontalOverflow: unmeasured(reason),
            emptyForm: unmeasured(reason),
            consoleErrors: summariseConsole([]),
          });
          continue;
        }
        collected = [];
        inflight = 0;
        let httpStatus = null;
        const offStatus = cdp.on('Network.responseReceived', (p) => {
          if (p.type === 'Document' && httpStatus === null) httpStatus = p.response?.status ?? null;
        });
        let navError = null;
        try {
          const loaded = cdp.once('Page.loadEventFired', { timeoutMs: navTimeoutMs });
          await cdp.send('Page.navigate', { url });
          await loaded;
          // Quiet-network settle: an SPA paints its shell at load and its data one round trip later,
          // so measuring at `load` would call every page blank.
          const deadline = Date.now() + settleTimeoutMs;
          for (;;) {
            if (inflight === 0 && Date.now() - lastActivity >= settleMs) break;
            if (Date.now() > deadline) break;
            await sleep(100);
          }
          await sleep(250); // one frame for the paint that the last response triggered
        } catch (e) {
          navError = String(e?.message ?? e);
        }
        offStatus();

        const snapshot = navError ? { error: `navigation failed: ${navError}` } : await collectSnapshot(cdp);
        const bodyText = await pageText(cdp);

        let screenshot = null;
        if (screenshotDir) screenshot = await captureScreenshot(cdp, join(screenshotDir, screenshotName(route, vp.name)));

        const { page, findings: pageFindings } = analyzeSnapshot(snapshot, {
          route,
          viewport: vp.name,
          expectsForm: expectsFormFor(entry),
          emptyFormSentinel: K.emptyFormSentinel ?? null,
          bodyText,
          consoleErrors: collected,
        });
        page.url = url;
        page.httpStatus = httpStatus;
        page.screenshot = screenshot;
        pages.push(page);
        findings.push(...pageFindings);
      }
    }
  } catch (e) {
    const reason = `the rig failed mid-run: ${String(e?.message ?? e)}`;
    return { ...base, unavailable: true, reason, ok: null, pages, findings, counts: null, browser: { binary: browser.binary, port: browser.port }, ms: Date.now() - started };
  } finally {
    try {
      if (cdp) await cdp.send('Browser.close', {}, { timeoutMs: 3000 }).catch(() => {});
    } catch {
      /* falls through to the kill below */
    }
    cdp?.close();
    browser.kill();
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const measured = pages.filter((p) => p.measured).length;
  const counts = {
    pages: pages.length,
    measured,
    unmeasured: pages.length - measured,
    blank: pages.filter((p) => p.blankPage?.blank === true).length,
    collapsedScrollers: pages.filter((p) => p.collapsedScroller?.collapsed === true).length,
    unusableInteractive: pages.reduce((n, p) => n + (p.offscreenInteractive?.unusable ?? 0), 0),
    horizontalOverflow: pages.filter((p) => p.horizontalOverflow?.overflows === true).length,
    emptyForms: pages.filter((p) => p.emptyForm?.empty === true).length,
    consoleErrors: pages.reduce((n, p) => n + (p.consoleErrors?.total ?? 0), 0),
  };
  return {
    ...base,
    // `ok` is null — not true — when nothing was measured. "No findings" out of zero measured pages
    // is the shape of every gate this project has had to fix.
    ok: measured === 0 ? null : errorCount === 0,
    unavailable: false,
    reason: measured === 0 ? 'no page was measured' : undefined,
    browser: { binary: browser.binary, port: browser.port },
    errorCount,
    warningCount: findings.length - errorCount,
    counts,
    pages,
    findings,
    ms: Date.now() - started,
  };
}

/** `document.body.innerText`, for the empty-form sentinel. Null (never `''`) when it cannot be read. */
async function pageText(cdp) {
  try {
    const r = await cdp.send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText : null', returnByValue: true });
    return typeof r.result?.value === 'string' ? r.result.value : null;
  } catch {
    return null;
  }
}

/** Base64 over CDP → written by Node, which is what makes a snap-confined browser a non-issue. */
async function captureScreenshot(cdp, absPath) {
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (typeof shot.data !== 'string') return { path: null, error: 'captureScreenshot returned no data' };
    writeFileSync(absPath, Buffer.from(shot.data, 'base64'));
    return { path: absPath, bytes: Buffer.byteLength(shot.data, 'base64') };
  } catch (e) {
    return { path: null, error: String(e?.message ?? e) };
  }
}

// ── the self-test: prove the gate FAILS on the known-bad case ────────────────────────────────────

/**
 * Reproduce `ce96a7bd` in the browser: put `height: auto` back on the shell's root `Col`.
 *
 * That one declaration is the whole bug. Under a `display: block` mount point (through two
 * `display: contents` theme wrappers) a `Col` with `flexGrow: 1` and no definite height sizes to its
 * content — measured at **98px**, the top bar plus the assistant strip — and the scroller inside it
 * collapses to `clientHeight: 0` around `scrollHeight: 719`.
 *
 * It runs before first paint, so the collapse is present from the app's first layout — which is when
 * the real bug applied — and it **records what it did** on `window.__RIG_INJECTION__`, which the
 * snapshot carries through to the report. An injection that silently failed to apply would make a
 * "broken" run indistinguishable from a healthy one — the same class of lie this whole module is built
 * to refuse. It earned that paranoia immediately: the first version observed
 * `document.documentElement`, which is **null** inside
 * `Page.addScriptToEvaluateOnNewDocument` (the script runs before any document content exists), so
 * `observe()` threw and nothing was ever broken. The self-test reported `applied: 0` and
 * `pass: false` instead of "proven", which is the only reason the hole was visible at all. Hence:
 * observe `document`, poll as well, keep re-applying (a React re-render can rewrite the style
 * attribute), and record any thrown error.
 */
export const SHELL_COLLAPSE_INJECTION = String.raw`(() => {
  const mark = (patch) => { window.__RIG_INJECTION__ = { kind: 'shell-collapse', ...(window.__RIG_INJECTION__ || {}), ...patch }; };
  mark({ applied: 0 });
  const breakIt = () => {
    try {
      const el = document.querySelector('div.is_Col');
      if (!el) return;
      if (el.style.height === 'auto') return;                 // already collapsed — nothing to redo
      el.style.setProperty('height', 'auto');
      el.style.setProperty('flex-grow', '1');
      mark({
        applied: (window.__RIG_INJECTION__.applied || 0) + 1,
        target: String(el.className).slice(0, 120),
        heightAfter: Math.round(el.getBoundingClientRect().height),
      });
    } catch (e) {
      mark({ error: String(e && e.message ? e.message : e) });
    }
  };
  try {
    // document (never null here), NOT document.documentElement (which IS null at injection time).
    new MutationObserver(breakIt).observe(document, { childList: true, subtree: true });
  } catch (e) {
    mark({ observerError: String(e && e.message ? e.message : e) });
  }
  // Belt and braces: React can rewrite the style attribute after a re-render, so re-apply on a timer
  // for long enough to cover the app's first data round trip, then stop.
  const timer = setInterval(breakIt, 50);
  setTimeout(() => clearInterval(timer), 15000);
  breakIt();
})()`;

/**
 * Run the rig twice on one route — clean, then with {@link SHELL_COLLAPSE_INJECTION} — and assert the
 * verdict flips. This is the rig's own regression gate: it is the difference between a check that
 * *would* catch the bug and a check *demonstrated* to catch it.
 *
 * `pass` requires all four: healthy not blank, healthy no collapsed scroller, broken blank, broken
 * collapsed. Anything else and the rig is not trustworthy — including "both broken", which usually
 * means the app under test is genuinely broken and the fixture needs fixing first.
 */
export async function renderRigSelfTest({ baseUrl, routes, viewports = [VIEWPORTS.desktop], screenshotDir = null, ...rest } = {}) {
  const healthy = await renderCheck({ baseUrl, routes, viewports, screenshotDir: screenshotDir ? join(screenshotDir, 'healthy') : null, ...rest });
  const broken = await renderCheck({
    baseUrl,
    routes,
    viewports,
    screenshotDir: screenshotDir ? join(screenshotDir, 'broken') : null,
    initScript: SHELL_COLLAPSE_INJECTION,
    ...rest,
  });
  return { ...compareSelfTest(healthy, broken), healthy, broken };
}

/** The pure verdict half of {@link renderRigSelfTest} — unit-testable without a browser. */
export function compareSelfTest(healthy, broken) {
  if (healthy.unavailable || broken.unavailable) {
    return { pass: null, reason: `the rig could not run: ${healthy.reason ?? broken.reason}`, checks: null };
  }
  const injected = broken.pages.reduce((n, p) => n + (p.injection?.applied ?? 0), 0);
  const checks = {
    healthyNotBlank: healthy.counts.blank === 0,
    healthyNoCollapse: healthy.counts.collapsedScrollers === 0,
    injectionApplied: injected > 0,
    brokenBlank: broken.counts.blank > 0,
    brokenCollapse: broken.counts.collapsedScrollers > 0,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    pass: failed.length === 0,
    failed,
    checks,
    injectionsApplied: injected,
    reason: failed.length === 0 ? undefined : `not demonstrated: ${failed.join(', ')}`,
    // `unusable` is carried as DATA, not as a required check: it is the third fingerprint of the bug
    // (the row buttons a user cannot click) but it only appears on a page that HAS row buttons, so
    // requiring it would make the self-test fail on, say, a create page.
    summary: {
      healthy: { blank: healthy.counts.blank, collapsed: healthy.counts.collapsedScrollers, unusable: healthy.counts.unusableInteractive, errors: healthy.errorCount },
      broken: { blank: broken.counts.blank, collapsed: broken.counts.collapsedScrollers, unusable: broken.counts.unusableInteractive, errors: broken.errorCount },
    },
  };
}

// ── CLI (`node scenarios/harness/lib/render-rig.mjs …`) ──────────────────────────────────────────

const USAGE = `render-rig — the layout gate (zero-dep CDP over Node's native WebSocket)

  node scenarios/harness/lib/render-rig.mjs <baseUrl> <route…> [--shots <dir>] [--desktop|--phone]
  node scenarios/harness/lib/render-rig.mjs --self-test <baseUrl> <route> [--shots <dir>]

  <route> is an AUTHORING route (index, plants, plants/[id]); pass a param as plants/[id]=<value>.

  node scenarios/harness/lib/render-rig.mjs http://localhost:45999/app/plant-care index plants plants/new
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    return argv.splice(i, 2)[1];
  };
  const has = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return false;
    argv.splice(i, 1);
    return true;
  };
  const selfTest = has('--self-test');
  const shots = flag('--shots');
  const only = has('--desktop') ? [VIEWPORTS.desktop] : has('--phone') ? [VIEWPORTS.phone] : null;
  const [baseUrl, ...routeArgs] = argv;
  if (!baseUrl || routeArgs.length === 0) {
    process.stdout.write(USAGE);
    process.exit(2);
  }
  const routes = routeArgs.map((a) => {
    const eq = a.indexOf('=');
    if (eq < 0) return a;
    const route = a.slice(0, eq);
    const value = a.slice(eq + 1);
    const name = /\[([^\]]+)\]/.exec(route)?.[1];
    return { route, params: name ? { [name]: value } : {} };
  });
  const opts = { baseUrl, routes, screenshotDir: shots ? (shots.startsWith('/') ? shots : join(process.cwd(), shots)) : null };
  const report = selfTest
    ? await renderRigSelfTest({ ...opts, viewports: only ?? [VIEWPORTS.desktop] })
    : await renderCheck({ ...opts, ...(only ? { viewports: only } : {}) });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  const ok = selfTest ? report.pass : report.ok;
  process.exit(ok === true ? 0 : 1);
}
