/**
 * render-rig.test.mjs — unit coverage for the LAYOUT gate's pure half.
 *
 * **No test here launches a browser.** That is the whole point of the split: `PAGE_SNAPSHOT_JS`
 * collects a serialisable snapshot and computes no verdicts, and {@link analyzeSnapshot} turns a
 * snapshot into checks and findings as a pure function. So every predicate — blank, collapsed
 * scroller, unreachable button, horizontal overflow, empty form — is testable against synthetic
 * inputs, in milliseconds, on a machine with no Chrome.
 *
 * The two headline fixtures are **recorded from the real fixture app** at `http://localhost:45999`
 * (project `plant-care`, route `plants`, desktop 1280×900), not invented:
 *
 *  - {@link HEALTHY} — the app as fixed in `ce96a7bd`: one scroller, `clientHeight 802`, 26 painted
 *    text elements in the content region, 12 interactive elements all reachable;
 *  - {@link COLLAPSED} — the same app with `height: auto` put back on the shell root: the root sizes
 *    to **98px**, the scroller is **`clientHeight: 0` around `scrollHeight: 719`**, the content region
 *    has zero area, and the eight row action buttons are laid out but unclickable.
 *
 * Those numbers are the bug (`ce96a7bd`) and they are asserted here so the predicates cannot be
 * loosened back into passing it. The live end-to-end demonstration is
 * `renderRigSelfTest` / `node scenarios/harness/lib/render-rig.mjs --self-test <baseUrl> <route>`.
 */
import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import {
  analyzeSnapshot,
  compareSelfTest,
  expectsFormFor,
  finding,
  findBrowser,
  renderCheck,
  routeUrl,
  screenshotName,
  specFileFor,
  summariseConsole,
  BLANK_TEXT_ELEMENTS,
  PAGE_SNAPSHOT_JS,
  PROFILE_BASE,
  SHELL_COLLAPSE_INJECTION,
  VIEWPORTS,
} from './render-rig.mjs';

// ── fixtures, recorded from the real app ─────────────────────────────────────────────────────────

const button = (text, x, y, { w = 122.3, h = 34, reachable = true, centerInView = true } = {}) => ({
  desc: 'button.is_Pressable.is_Text._ws-inherit._ww-inherit',
  text,
  rect: { x, y, w, h },
  centerInView,
  reachable,
});

/** `plants` @ desktop, after the `ce96a7bd` fix. */
const HEALTHY = {
  viewport: { width: 1280, height: 900 },
  url: 'http://localhost:45999/app/plant-care/plants',
  title: '',
  scrollers: [
    { desc: 'div.is_Box.is_Text._dsp-block._ws-inherit', clientHeight: 802, scrollHeight: 802, clientWidth: 1280, rect: { x: 0, y: 57, w: 1280, h: 802 }, laidOut: true },
  ],
  region: { kind: 'scroller', desc: 'div.is_Box.is_Text._dsp-block._ws-inherit', rect: { x: 0, y: 57, w: 1280, h: 802 }, box: { left: 0, top: 57, right: 1280, bottom: 859 }, samples: 4000 },
  content: { textElements: 26, elements: 61, texts: ['All Plants', 'Monstera', 'living room', 'Snake plant'], chars: 254 },
  viewportContent: { textElements: 31, elements: 69 },
  interactive: [
    button('Home', 170, 8, { w: 67, h: 40 }),
    button('Plants', 244, 8, { w: 68, h: 40 }),
    button('New', 321, 8, { w: 58, h: 40 }),
    button('Watered today', 24, 265),
    button('Toggle resting', 154.3, 265, { w: 119.8 }),
    button('Watered today', 24, 412),
    button('Toggle resting', 154.3, 412, { w: 119.8 }),
  ],
  controls: 0,
  bodyTextChars: 297,
  horizontal: { scrollWidth: 1280, clientWidth: 1280 },
  injection: null,
};

/** The same page with `height: auto` back on the shell root — the exact `ce96a7bd` geometry. */
const COLLAPSED = {
  ...HEALTHY,
  scrollers: [
    { desc: 'div.is_Box.is_Text._dsp-block._ws-inherit', clientHeight: 0, scrollHeight: 719, clientWidth: 1280, rect: { x: 0, y: 57, w: 1280, h: 0 }, laidOut: true },
  ],
  region: { kind: 'scroller', desc: 'div.is_Box.is_Text._dsp-block._ws-inherit', rect: { x: 0, y: 57, w: 1280, h: 0 }, box: { left: 0, top: 57, right: 1280, bottom: 57 }, samples: 0 },
  content: { textElements: 0, elements: 0, texts: [], chars: 0 },
  // The chrome painted perfectly: the brand, three nav labels and "Assistant". That is the whole
  // reason a whole-viewport measurement would have called this page fine.
  viewportContent: { textElements: 5, elements: 12 },
  interactive: [
    button('Home', 170, 8, { w: 67, h: 40 }),
    button('Plants', 244, 8, { w: 68, h: 40 }),
    button('New', 321, 8, { w: 58, h: 40 }),
    button('Watered today', 24, 265, { reachable: false }),
    button('Toggle resting', 154.3, 265, { w: 119.8, reachable: false }),
    button('Watered today', 24, 412, { reachable: false }),
    button('Toggle resting', 154.3, 412, { w: 119.8, reachable: false }),
  ],
  injection: { kind: 'shell-collapse', applied: 1, target: 'is_Col is_View _fd-column _height-10037 _flexGrow-1', heightAfter: 98 },
};

const CTX = { route: 'plants', viewport: 'desktop', emptyFormSentinel: 'Nothing to fill in.', bodyText: 'Houseplant Care Home Plants New' };
const codes = (findings) => findings.map((f) => f.code).sort();

// ── the two headline cases ───────────────────────────────────────────────────────────────────────

describe('the healthy fixture (the app as ce96a7bd fixed it)', () => {
  const { page, findings } = analyzeSnapshot(HEALTHY, CTX);

  it('reports no findings at all — a rig that flags the fixed app is wrong', () => {
    expect(findings).toEqual([]);
  });

  it('measured every check', () => {
    for (const key of ['blankPage', 'collapsedScroller', 'offscreenInteractive', 'horizontalOverflow', 'emptyForm']) {
      expect(page[key].measured, `${key} was not measured`).toBe(true);
    }
  });

  it('carries the numbers, not just verdicts', () => {
    expect(page.blankPage).toMatchObject({ blank: false, textElements: 26, viewportTextElements: 31, region: 'scroller' });
    expect(page.collapsedScroller).toMatchObject({ collapsed: false, total: 1 });
    expect(page.offscreenInteractive).toMatchObject({ total: 7, unusable: 0, belowFold: 0 });
    expect(page.horizontalOverflow).toMatchObject({ overflows: false, scrollWidth: 1280, clientWidth: 1280, by: 0 });
  });
});

describe('the collapsed fixture (ce96a7bd itself)', () => {
  const { page, findings } = analyzeSnapshot(COLLAPSED, CTX);

  it('fires all three layout checks — this is the case every other gate passes', () => {
    expect(codes(findings)).toEqual(['collapsed-scroller', 'empty-render', 'offscreen-interactive']);
  });

  it('names the collapsed scroller with BOTH numbers, so the reader can act on it', () => {
    expect(page.collapsedScroller.collapsed).toBe(true);
    expect(page.collapsedScroller.offenders[0]).toMatchObject({ desc: 'div.is_Box.is_Text._dsp-block._ws-inherit', clientHeight: 0, scrollHeight: 719 });
    const f = findings.find((x) => x.code === 'collapsed-scroller');
    expect(f.message).toContain('clientHeight 0');
    expect(f.message).toContain('scrollHeight 719');
    expect(f.message).toContain('div.is_Box');
    // Routed at the shell, because that is where a collapsed height chain lives.
    expect(f.message).toContain('_shell.view.json');
  });

  it('calls the page blank on CONTENT-REGION paint, not on the whole viewport', () => {
    expect(page.blankPage).toMatchObject({ measured: true, blank: true, textElements: 0, viewportTextElements: 5 });
    // The distinction that matters: 5 things DID paint. Measuring the viewport would score this clean.
    expect(findings.find((f) => f.code === 'empty-render').message).toContain('shell chrome');
  });

  it('reports the row buttons as laid out but unreachable, with coordinates', () => {
    expect(page.offscreenInteractive).toMatchObject({ total: 7, unusable: 4 });
    expect(page.offscreenInteractive.unreachable).toHaveLength(4);
    expect(page.offscreenInteractive.offscreen).toEqual([]); // clipped, not negatively positioned
    const f = findings.find((x) => x.code === 'offscreen-interactive');
    expect(f.message).toContain('Watered today at (24, 265)');
    expect(f.message).toContain('a11y tree');
  });

  it('keeps the injection receipt, so a "broken" run cannot be faked', () => {
    expect(page.injection).toMatchObject({ applied: 1, heightAfter: 98 });
  });
});

// ── the honesty rules ────────────────────────────────────────────────────────────────────────────

describe('null-with-a-reason, never 0 and never false', () => {
  const { page, findings } = analyzeSnapshot({ error: 'browser-side probe threw: ReferenceError: x is not defined' }, CTX);

  it('marks every check unmeasured, carrying the reason', () => {
    for (const key of ['blankPage', 'collapsedScroller', 'offscreenInteractive', 'horizontalOverflow', 'emptyForm']) {
      expect(page[key], key).toEqual({ measured: false, reason: expect.stringContaining('ReferenceError') });
    }
    expect(page.measured).toBe(false);
  });

  it('never reports a verdict of false or a count of 0 for a check that did not run', () => {
    for (const key of ['blankPage', 'collapsedScroller', 'offscreenInteractive', 'horizontalOverflow', 'emptyForm']) {
      const check = page[key];
      for (const verdict of ['blank', 'collapsed', 'overflows', 'empty']) expect(check[verdict], `${key}.${verdict}`).toBeUndefined();
      for (const count of ['textElements', 'total', 'unusable']) expect(check[count], `${key}.${count}`).toBeUndefined();
    }
  });

  it('raises a render-error finding that says UNMEASURED, not clean', () => {
    expect(codes(findings)).toEqual(['render-error']);
    expect(findings[0].message).toContain('UNMEASURED, not clean');
  });

  it('treats a missing snapshot the same way as a thrown one', () => {
    const { page: p, findings: f } = analyzeSnapshot(null, CTX);
    expect(p.measured).toBe(false);
    expect(p.blankPage.reason).toBe('no snapshot was collected');
    expect(codes(f)).toEqual(['render-error']);
  });

  it('reports "no content region" as unmeasured rather than as blank', () => {
    const { page: p, findings: f } = analyzeSnapshot({ ...HEALTHY, region: { kind: 'none', samples: 0 } }, CTX);
    expect(p.blankPage).toEqual({ measured: false, reason: expect.stringContaining('no content region') });
    expect(f.find((x) => x.code === 'empty-render').message).toContain('UNMEASURED');
  });

  it('reports a zero-area content region as BLANK, not as unmeasured — there is nowhere to paint', () => {
    const { page: p } = analyzeSnapshot(COLLAPSED, CTX);
    expect(p.blankPage.measured).toBe(true);
    expect(p.blankPage.blank).toBe(true);
    expect(p.blankPage.reason).toContain('zero area');
  });

  it('reports unmeasured for each individual check whose input is missing', () => {
    const { page: p } = analyzeSnapshot({ ...HEALTHY, scrollers: undefined, interactive: undefined, horizontal: undefined }, CTX);
    expect(p.collapsedScroller).toEqual({ measured: false, reason: expect.stringContaining('no scroller list') });
    expect(p.offscreenInteractive).toEqual({ measured: false, reason: expect.stringContaining('no interactive-element list') });
    expect(p.horizontalOverflow).toEqual({ measured: false, reason: expect.stringContaining('no documentElement width pair') });
    // …and the checks that COULD run still ran.
    expect(p.blankPage.measured).toBe(true);
  });
});

describe('renderCheck when no browser can be launched', () => {
  it('is unavailable with a reason, ok:null — never an empty pass', async () => {
    const report = await renderCheck({ baseUrl: 'http://127.0.0.1:1/app/x', routes: ['index'], binary: '/nonexistent/chrome-does-not-exist' });
    expect(report.unavailable).toBe(true);
    expect(report.ok).toBeNull();
    expect(report.reason).toMatch(/no Chrome|chrome-does-not-exist|exited|never printed/i);
    expect(report.pages).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.counts).toBeNull(); // `{blank: 0, …}` here would read as a clean run
  });

  it('finds a real browser on this machine, or returns null (never a guessed path)', () => {
    const bin = findBrowser();
    expect(bin === null || typeof bin === 'string').toBe(true);
    expect(findBrowser(['/definitely/not/here'])).toBeNull();
  });

  it('puts the browser profile somewhere a SNAP build can actually write', () => {
    // Snap confinement: inside $HOME, and not in a hidden dir. `/tmp/…` and `~/.cache/…` both fail
    // with "Chromium cannot read and write to its data directory" — both were hit for real.
    expect(PROFILE_BASE.startsWith(homedir() + '/')).toBe(true);
    const rel = PROFILE_BASE.slice(homedir().length + 1);
    expect(rel.split('/').some((seg) => seg.startsWith('.'))).toBe(false);
  });
});

// ── the individual predicates ────────────────────────────────────────────────────────────────────

describe('the blank predicate', () => {
  const withText = (n) => analyzeSnapshot({ ...HEALTHY, content: { ...HEALTHY.content, textElements: n } }, CTX);

  it('is zero-tolerance by design: one painted text element is not blank', () => {
    expect(BLANK_TEXT_ELEMENTS).toBe(0);
    expect(withText(1).page.blankPage.blank).toBe(false);
    expect(withText(1).findings).toEqual([]);
  });

  it('flags zero painted text elements in a region that WAS sampled', () => {
    const { page, findings } = withText(0);
    expect(page.blankPage).toMatchObject({ blank: true, samples: 4000 });
    expect(codes(findings)).toEqual(['empty-render']);
    expect(findings[0].message).toContain('4000 hit-test samples');
  });

  it('does not flag an empty-state page — its empty-state text still paints', () => {
    const emptyList = { ...HEALTHY, content: { textElements: 2, elements: 4, texts: ['No plants yet', 'Add your first plant'], chars: 33 } };
    expect(analyzeSnapshot(emptyList, CTX).findings).toEqual([]);
  });
});

describe('the collapsed-scroller predicate', () => {
  const withScroller = (s) => analyzeSnapshot({ ...HEALTHY, scrollers: [{ desc: 'div.x', clientWidth: 100, rect: { x: 0, y: 0, w: 100, h: 0 }, laidOut: true, ...s }] }, CTX);

  it('needs BOTH halves: zero clientHeight AND content to clip', () => {
    expect(withScroller({ clientHeight: 0, scrollHeight: 719 }).page.collapsedScroller.collapsed).toBe(true);
    // A scroller with nothing in it is not this bug — it is an empty page, which `blankPage` owns.
    expect(withScroller({ clientHeight: 0, scrollHeight: 0 }).page.collapsedScroller.collapsed).toBe(false);
    // Ordinary overflow: taller content than box, but the box HAS a height, so it scrolls.
    expect(withScroller({ clientHeight: 802, scrollHeight: 1900 }).page.collapsedScroller.collapsed).toBe(false);
  });

  it('reports every offender, not just the first', () => {
    const two = {
      ...HEALTHY,
      scrollers: [
        { desc: 'div.outer', clientHeight: 0, scrollHeight: 719, clientWidth: 1280, rect: {}, laidOut: true },
        { desc: 'div.inner', clientHeight: 0, scrollHeight: 120, clientWidth: 1280, rect: {}, laidOut: true },
      ],
    };
    const { page, findings } = analyzeSnapshot(two, CTX);
    expect(page.collapsedScroller.offenders.map((o) => o.desc)).toEqual(['div.outer', 'div.inner']);
    expect(findings.filter((f) => f.code === 'collapsed-scroller')).toHaveLength(2);
  });

  it('counts a page with no scroll container as measured-and-clean, not unmeasured', () => {
    const { page } = analyzeSnapshot({ ...HEALTHY, scrollers: [] }, CTX);
    expect(page.collapsedScroller).toEqual({ measured: true, collapsed: false, total: 0, offenders: [] });
  });
});

describe('the offscreen/unreachable predicate', () => {
  const withInteractive = (items) => analyzeSnapshot({ ...HEALTHY, interactive: items }, CTX);

  it('flags an element wholly above the viewport (the y:-107 case)', () => {
    const { page, findings } = withInteractive([button('Watered today', 24, -141, { h: 34, reachable: null, centerInView: false })]);
    expect(page.offscreenInteractive.offscreen).toHaveLength(1);
    expect(codes(findings)).toEqual(['offscreen-interactive']);
    expect(findings[0].message).toContain('(24, -141)');
  });

  it('flags an element wholly left of the viewport', () => {
    expect(withInteractive([button('x', -200, 40, { w: 100 })]).page.offscreenInteractive.offscreen).toHaveLength(1);
  });

  it('flags a zero-area element', () => {
    expect(withInteractive([button('x', 10, 10, { w: 0, h: 0 })]).page.offscreenInteractive.zeroArea).toHaveLength(1);
  });

  it('does NOT flag a button merely scrolled below the fold — that is normal', () => {
    const { page, findings } = withInteractive([button('Save', 24, 1400, { reachable: null, centerInView: false })]);
    expect(page.offscreenInteractive).toMatchObject({ unusable: 0, belowFold: 1 });
    expect(findings).toEqual([]);
  });

  it('does NOT flag `reachable: null` — that is "not asked", not "failed"', () => {
    expect(withInteractive([button('x', 24, 100, { reachable: null })]).page.offscreenInteractive.unusable).toBe(0);
  });

  it('caps the examples list but keeps the full counts', () => {
    const many = Array.from({ length: 9 }, (_, i) => button(`b${i}`, 24, 100 + i * 40, { reachable: false }));
    const { page } = withInteractive(many);
    expect(page.offscreenInteractive.unusable).toBe(9);
    expect(page.offscreenInteractive.unreachable).toHaveLength(9);
    expect(page.offscreenInteractive.examples).toHaveLength(4);
  });
});

describe('the horizontal-overflow predicate', () => {
  const withWidths = (scrollWidth, clientWidth) => analyzeSnapshot({ ...HEALTHY, horizontal: { scrollWidth, clientWidth } }, CTX);

  it('allows one pixel of slack (sub-pixel rounding), flags two', () => {
    expect(withWidths(1281, 1280).page.horizontalOverflow.overflows).toBe(false);
    expect(withWidths(1282, 1280).page.horizontalOverflow.overflows).toBe(true);
    expect(codes(withWidths(1282, 1280).findings)).toEqual(['horizontal-overflow']);
  });

  it('reports by how much', () => {
    expect(withWidths(1500, 1280).page.horizontalOverflow).toMatchObject({ scrollWidth: 1500, clientWidth: 1280, by: 220 });
  });
});

describe('the empty-form predicate (the Wave-2 "Nothing to fill in." bug)', () => {
  it('is not applicable on a page where no form is expected', () => {
    const { page, findings } = analyzeSnapshot(HEALTHY, { ...CTX, expectsForm: false });
    expect(page.emptyForm).toMatchObject({ measured: true, applicable: false, empty: null });
    expect(findings).toEqual([]);
  });

  it('flags the renderer\'s own sentinel, and says the Input schema derived zero fields', () => {
    const { page, findings } = analyzeSnapshot({ ...HEALTHY, controls: 0 }, {
      ...CTX,
      route: 'plants/new',
      expectsForm: true,
      bodyText: 'Add Plant\nNothing to fill in.',
    });
    expect(page.emptyForm).toMatchObject({ empty: true, sentinelPresent: true, basis: 'sentinel', controls: 0 });
    const f = findings.find((x) => x.code === 'empty-form');
    expect(f.message).toContain('Input schema derived ZERO fields');
    expect(f.file).toBe('pages/plants/new.view.json');
  });

  it('flags zero controls even without the sentinel, and names the OTHER cause (a shadowed route)', () => {
    const { page, findings } = analyzeSnapshot({ ...HEALTHY, controls: 0, content: { ...HEALTHY.content, texts: ['Plant Detail', 'Toggle resting'] } }, {
      ...CTX,
      route: 'plants/new',
      expectsForm: true,
      bodyText: 'Plant Detail\nNo watering history yet',
    });
    expect(page.emptyForm).toMatchObject({ empty: true, sentinelPresent: false, basis: 'control-count' });
    const f = findings.find((x) => x.code === 'empty-form');
    expect(f.message).toContain('shadow');
    // The evidence of WHICH page rendered instead is in the message, not left to the reader to guess.
    expect(f.message).toContain('Plant Detail');
  });

  it('passes a form that has fields', () => {
    const { findings } = analyzeSnapshot({ ...HEALTHY, controls: 5 }, { ...CTX, route: 'plants/new', expectsForm: true, bodyText: 'Add Plant Name Room' });
    expect(findings).toEqual([]);
  });

  it('is UNMEASURED (with a warning) when the product sentinel could not be read', () => {
    const { page, findings } = analyzeSnapshot({ ...HEALTHY, controls: 0 }, { ...CTX, route: 'plants/new', expectsForm: true, emptyFormSentinel: null });
    expect(page.emptyForm).toEqual({ measured: false, reason: expect.stringContaining('form.tsx') });
    expect(findings.find((f) => f.code === 'empty-form').severity).toBe('warning');
  });
});

describe('console errors are DATA, never a verdict', () => {
  it('records the fixture\'s known dashboard-stats 500 without failing the page', () => {
    const entries = [
      { source: 'network', level: 'error', text: 'HTTP 500 http://localhost:45999/app/plant-care/api/dashboard-stats', status: 500 },
      { source: 'log', level: 'error', text: 'Failed to load resource: the server responded with a status of 500' },
    ];
    const { page, findings } = analyzeSnapshot(HEALTHY, { ...CTX, consoleErrors: entries });
    expect(page.consoleErrors).toMatchObject({ measured: true, total: 2, network: 1, log: 1, console: 0 });
    expect(findings).toEqual([]); // `renderSmokeViews` already owns this one, routed at the endpoint
  });

  it('summarises an empty list as measured, and caps the entries it carries', () => {
    expect(summariseConsole([])).toMatchObject({ measured: true, total: 0 });
    expect(summariseConsole(Array.from({ length: 30 }, () => ({ source: 'console' }))).entries).toHaveLength(10);
    expect(summariseConsole(undefined)).toMatchObject({ measured: true, total: 0 });
  });
});

// ── finding shape (must merge with the other two gates' lists) ────────────────────────────────────

describe('findings are ViewError-shaped', () => {
  it('carries exactly code/path/message/severity, plus file and the rig\'s route+viewport', () => {
    const f = finding({ code: 'empty-render', message: 'x', file: 'pages/index.view.json', route: 'index', viewport: 'phone' });
    expect(f).toEqual({ code: 'empty-render', path: '', message: 'x', severity: 'error', file: 'pages/index.view.json', route: 'index', viewport: 'phone' });
  });

  it('shapes every real finding the same way', () => {
    const { findings } = analyzeSnapshot(COLLAPSED, CTX);
    for (const f of findings) {
      expect(typeof f.code).toBe('string');
      expect(typeof f.path).toBe('string');
      expect(typeof f.message).toBe('string');
      expect(['error', 'warning']).toContain(f.severity);
      expect(f.file).toBe('pages/plants.view.json');
      // Every message says WHICH viewport, because the two archetypes fail independently.
      expect(f.message).toContain('@ desktop');
    }
  });

  it('files a finding against the route\'s own spec artifact', () => {
    expect(specFileFor('index')).toBe('pages/index.view.json');
    expect(specFileFor('plants/[id]')).toBe('pages/plants/[id].view.json');
    expect(specFileFor('pages/x.view.json')).toBe('pages/pages/x.view.json'); // no double suffix
  });
});

// ── route → URL ──────────────────────────────────────────────────────────────────────────────────

describe('routeUrl', () => {
  const base = 'http://localhost:45999/app/plant-care';

  it('maps authoring routes onto served paths', () => {
    expect(routeUrl(base, 'index').url).toBe(`${base}/`);
    expect(routeUrl(base, 'plants').url).toBe(`${base}/plants`);
    expect(routeUrl(base, 'plants/new').url).toBe(`${base}/plants/new`);
  });

  it('substitutes and URL-encodes a supplied param', () => {
    expect(routeUrl(base, { route: 'plants/[id]', params: { id: 'a b/c' } }).url).toBe(`${base}/plants/a%20b%2Fc`);
  });

  it('SKIPS a parameterised route with no value rather than inventing an id', () => {
    const r = routeUrl(base, 'plants/[id]');
    expect(r.url).toBeNull();
    expect(r.skip).toContain('id');
    expect(r.skip).toContain('params');
  });

  it('honours an explicit url — appended to the base, or taken whole when absolute', () => {
    expect(routeUrl(base, { route: 'x', url: '/anything?q=1' }).url).toBe(`${base}/anything?q=1`);
    expect(routeUrl(base, { route: 'x', url: 'http://elsewhere/z' }).url).toBe('http://elsewhere/z');
  });

  it('tolerates a trailing slash on the base', () => {
    expect(routeUrl(`${base}/`, 'plants').url).toBe(`${base}/plants`);
  });
});

describe('expectsFormFor', () => {
  it('derives from the last route segment', () => {
    expect(expectsFormFor('plants/new')).toBe(true);
    expect(expectsFormFor('plants/[id]/edit')).toBe(true);
    expect(expectsFormFor('bookings/create')).toBe(true);
    expect(expectsFormFor('plants')).toBe(false);
    expect(expectsFormFor('index')).toBe(false);
  });

  it('lets an explicit flag win in both directions', () => {
    expect(expectsFormFor({ route: 'plants', expectsForm: true })).toBe(true);
    expect(expectsFormFor({ route: 'plants/new', expectsForm: false })).toBe(false);
  });
});

describe('screenshotName', () => {
  it('is a stable, filesystem-safe name per route and viewport', () => {
    expect(screenshotName('plants/[id]', 'phone')).toBe('phone__plants-id.png');
    expect(screenshotName('index', 'desktop')).toBe('desktop__index.png');
  });
});

// ── the self-test verdict ────────────────────────────────────────────────────────────────────────

const report = ({ blank, collapsed, unusable = 0, errorCount = 0, injected = 0, unavailable = false, reason }) => ({
  unavailable,
  reason,
  errorCount,
  counts: { blank, collapsedScrollers: collapsed, unusableInteractive: unusable },
  pages: [{ injection: injected ? { applied: injected } : null }],
});

describe('compareSelfTest — "a rig not demonstrated to fail on the known-bad case is worthless"', () => {
  it('passes only when the verdict FLIPS and the injection actually applied', () => {
    const r = compareSelfTest(report({ blank: 0, collapsed: 0 }), report({ blank: 1, collapsed: 1, errorCount: 2, injected: 1 }));
    expect(r.pass).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.injectionsApplied).toBe(1);
  });

  it('FAILS when the injection never applied — the real hole this caught on its first run', () => {
    const r = compareSelfTest(report({ blank: 0, collapsed: 0 }), report({ blank: 0, collapsed: 0, injected: 0 }));
    expect(r.pass).toBe(false);
    expect(r.failed).toEqual(['injectionApplied', 'brokenBlank', 'brokenCollapse']);
    expect(r.reason).toContain('not demonstrated');
  });

  it('FAILS when the healthy app is already broken — fix the fixture, not the rig', () => {
    const r = compareSelfTest(report({ blank: 1, collapsed: 1 }), report({ blank: 1, collapsed: 1, injected: 1 }));
    expect(r.pass).toBe(false);
    expect(r.failed).toEqual(['healthyNotBlank', 'healthyNoCollapse']);
  });

  it('is pass:null with a reason when the rig could not run — never pass:false', () => {
    const r = compareSelfTest(report({ blank: 0, collapsed: 0, unavailable: true, reason: 'no Chrome/Chromium found' }), report({ blank: 1, collapsed: 1 }));
    expect(r.pass).toBeNull();
    expect(r.reason).toContain('no Chrome');
    expect(r.checks).toBeNull();
  });
});

// ── browser-side source hygiene ──────────────────────────────────────────────────────────────────

describe('the browser-side sources', () => {
  // Both are `String.raw` template literals, so ONE backtick anywhere inside them terminates the
  // template and the whole module stops parsing. That happened twice while writing this file, from a
  // prose comment quoting an identifier, and it is invisible until Node refuses to import the module.
  it('contain no backtick', () => {
    expect(PAGE_SNAPSHOT_JS).not.toContain('`');
    expect(SHELL_COLLAPSE_INJECTION).not.toContain('`');
  });

  it('are syntactically valid JavaScript expressions', () => {
    expect(() => new Function(`return ${PAGE_SNAPSHOT_JS}`)).not.toThrow();
    expect(() => new Function(`return ${SHELL_COLLAPSE_INJECTION}`)).not.toThrow();
  });

  it('observe `document`, not `document.documentElement` — which is null at injection time', () => {
    expect(SHELL_COLLAPSE_INJECTION).toContain('observe(document,');
    expect(SHELL_COLLAPSE_INJECTION).not.toContain('observe(document.documentElement');
  });

  it('records what the injection did, so a no-op injection cannot read as a broken app', () => {
    expect(SHELL_COLLAPSE_INJECTION).toContain('__RIG_INJECTION__');
    expect(SHELL_COLLAPSE_INJECTION).toContain('applied');
    expect(PAGE_SNAPSHOT_JS).toContain('__RIG_INJECTION__');
  });

  it('skips elements with no client rects, so a media-query-hidden nav is not an offscreen button', () => {
    expect(PAGE_SNAPSHOT_JS).toContain('getClientRects().length === 0');
  });
});

describe('VIEWPORTS', () => {
  it('are the two real archetypes — the phone nav relocates and can fail on its own', () => {
    expect(VIEWPORTS.desktop).toMatchObject({ name: 'desktop', width: 1280, height: 900, mobile: false });
    expect(VIEWPORTS.phone).toMatchObject({ name: 'phone', width: 390, height: 844, mobile: true });
  });
});
