import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectHostTools } from '../globals/host-tools.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { loadSystemSpaces } from './system.js';
import { transpileStatement } from '../typecheck/transpile.js';
import type { RenderHost } from '../session/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');

const logs: string[] = [];
const host: RenderHost = {
  display: (d) => logs.push(`display:${typeof d === 'string' ? d : JSON.stringify(d)}`),
  ask: async () => undefined,
  log: (m) => logs.push(`log:${m}`),
};

/** Inject a space's functions into the VM the way Session.injectSpaceFunctions does. */
function injectFunctions(vm: VM, functions: Record<string, string>): void {
  for (const [name, src] of Object.entries(functions)) {
    const js = transpileStatement(src)
      .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
      .replace(/^export\s+default\s+/gm, `const ${name} = `)
      .replace(/^export\s+/gm, '');
    const r = vm.evalScript(`${js}\nglobalThis['${name}'] = ${name};`);
    if (!r.ok) throw new Error(`inject ${name} failed: ${r.error}`);
  }
}

function evalDump(vm: VM, code: string): unknown {
  const res = vm.ctx.evalCode(code);
  if (res.error) {
    const err = vm.ctx.dump(res.error);
    res.error.dispose();
    throw new Error(`eval error: ${JSON.stringify(err)}`);
  }
  const value = vm.ctx.dump(res.value);
  res.value.dispose();
  return value;
}

/** Evaluate `await (<expr>)` and dump the resolved value — `webFetch`/`webSearch` are
 *  async functions now; a bare (un-awaited) `ctx.evalCode` would just dump the pending
 *  Promise. When the stubbed `fetch` resolves via a real (already-settled) Promise, the
 *  host-bridge's continuation runs as a Node microtask, not synchronously within
 *  `drivePendingJobs()` — so this must actually yield to the event loop before reading
 *  the value back (reuses the same propagate-then-readback path turn-loop uses). */
async function evalAwaitDump(vm: VM, expr: string): Promise<unknown> {
  const res = vm.evalStatement(`const __r = await (${expr}); globalThis['__r'] = __r;`);
  if (!res.ok) throw new Error(`eval error: ${res.error}`);
  for (let i = 0; i < 5 && vm.getVar('__r') === undefined; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    vm.drivePendingJobs();
  }
  return vm.getVar('__r');
}

describe('system/memory functions (round-trip through host primitives)', () => {
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    logs.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'sysfn-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: dir });
    const [mem] = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'system-global')]);
    injectFunctions(vm, mem!.functions);
  });

  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('remember then recall returns the stored value', () => {
    evalDump(vm, `remember("topic", { title: "pasta", n: 3 })`);
    const r = evalDump(vm, `recall("topic")`) as { found: boolean; value: { title: string; n: number } };
    expect(r.found).toBe(true);
    expect(r.value.title).toBe('pasta');
    expect(r.value.n).toBe(3);
    expect(existsSync(join(dir, '.lmthing', 'memory.json'))).toBe(true);
  });

  it('recall of an unknown key reports not found', () => {
    const r = evalDump(vm, `recall("nope")`) as { found: boolean; value: unknown };
    expect(r.found).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it('recallAll returns every fact; forget removes one', () => {
    evalDump(vm, `remember("a", 1)`);
    evalDump(vm, `remember("b", 2)`);
    let all = evalDump(vm, `recallAll()`) as { facts: Record<string, number> };
    expect(all.facts).toEqual({ a: 1, b: 2 });
    evalDump(vm, `forget("a")`);
    all = evalDump(vm, `recallAll()`) as { facts: Record<string, number> };
    expect(all.facts).toEqual({ b: 2 });
  });
});

describe('system/fs readFile function', () => {
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sysfs-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: dir });
    const [fs] = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'system-global')]);
    injectFunctions(vm, fs!.functions);
  });

  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('raw contains unmodified file content (no line numbers)', () => {
    const path = join(dir, 'data.json');
    require('node:fs').writeFileSync(path, '{"x":1}');
    const r = evalDump(vm, `readFile(${JSON.stringify(path)})`) as { ok: boolean; content: string; raw: string };
    expect(r.ok).toBe(true);
    expect(r.raw).toBe('{"x":1}');
    expect(JSON.parse(r.raw)).toEqual({ x: 1 });
  });

  it('content has 1-based line numbers; raw does not', () => {
    const path = join(dir, 'multi.txt');
    require('node:fs').writeFileSync(path, 'alpha\nbeta\ngamma');
    const r = evalDump(vm, `readFile(${JSON.stringify(path)})`) as { ok: boolean; content: string; raw: string };
    expect(r.ok).toBe(true);
    expect(r.raw).toBe('alpha\nbeta\ngamma');
    expect(r.content).toContain('1\talpha');
    expect(r.content).toContain('2\tbeta');
    expect(r.content).toContain('3\tgamma');
    expect(r.content).not.toContain('{"');
  });

  it('grep returns matches when path is a single file', () => {
    const path = join(dir, 'target.ts');
    require('node:fs').writeFileSync(path, 'export function foo() {}\nexport function bar() {}\n');
    const r = evalDump(vm, `grep("function", { path: ${JSON.stringify(path)} })`) as {
      ok: boolean; matches: Array<{ file: string; line: number; text: string }>
    };
    expect(r.ok).toBe(true);
    expect(r.matches.length).toBe(2);
    expect(r.matches[0]!.file).toBe(path);
    expect(r.matches[0]!.line).toBe(1);
    expect(r.matches[1]!.line).toBe(2);
  });

  it('grep distinguishes a nonexistent path from "no matches"', () => {
    const missing = join(dir, 'no-such-dir', 'nope');
    const r = evalDump(vm, `grep("anything", { path: ${JSON.stringify(missing)} })`) as {
      ok: boolean; matches: unknown[]; error?: string
    };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/path not found/);
    // Contrast: an existing file with no match is ok:true, empty matches.
    const path = join(dir, 'empty.txt');
    require('node:fs').writeFileSync(path, 'nothing here\n');
    const r2 = evalDump(vm, `grep("zzzzz", { path: ${JSON.stringify(path)} })`) as { ok: boolean; matches: unknown[] };
    expect(r2.ok).toBe(true);
    expect(r2.matches.length).toBe(0);
  });
});

describe('system/web webFetch function (HTML → text)', () => {
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sysweb-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: dir });
    const [web] = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'system-global')]);
    injectFunctions(vm, web!.functions);
  });

  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  const HTML =
    '<!doctype html><html><head><title>T</title><style>.a{color:red}</style></head>' +
    '<body><h1>Hello &amp; welcome</h1><script>var x=1;</script>' +
    '<p>First para.</p><p>Second &lt;para&gt;.</p>' +
    '<p>See <a href="https://example.com/page">the docs</a> for more.</p>' +
    '<ul><li>One</li><li>Two</li></ul></body></html>';

  /** Override the host fetch with a real-Promise-returning stub for fixed HTML
   *  (webFetch is now `async function ... { await fetch(...) }`, so the stub must
   *  resolve like the real yield-based fetch global does). */
  function stubFetch(htmlBody: string): void {
    injectGlobal(vm.ctx, 'fetch', ((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => htmlBody,
        json: () => ({}),
      })) as (...a: unknown[]) => unknown);
  }

  it('strips tags/script/style and decodes entities by default', async () => {
    stubFetch(HTML);
    const r = await evalAwaitDump(vm, `webFetch("http://x")`) as { ok: boolean; content: string };
    expect(r.ok).toBe(true);
    expect(r.content).toContain('Hello & welcome');
    expect(r.content).toContain('First para.');
    expect(r.content).toContain('Second <para>.');
    expect(r.content).not.toContain('<p>');
    expect(r.content).not.toContain('var x=1'); // script body dropped
    expect(r.content).not.toContain('color:red'); // style body dropped
  });

  it('returns raw HTML when format:"html"', async () => {
    stubFetch(HTML);
    const r = await evalAwaitDump(vm, `webFetch("http://x", { format: "html" })`) as { content: string };
    expect(r.content).toContain('<p>First para.</p>');
  });

  it('preserves structure as Markdown when format:"markdown"', async () => {
    stubFetch(HTML);
    const r = await evalAwaitDump(vm, `webFetch("http://x", { format: "markdown" })`) as { content: string };
    expect(r.content).toContain('# Hello & welcome');
    expect(r.content).toContain('[the docs](https://example.com/page)');
    expect(r.content).toContain('- One');
    expect(r.content).toContain('- Two');
    expect(r.content).not.toContain('<h1>');
    expect(r.content).not.toContain('<a ');
  });

  // A client-rendered page: the server sends an empty app shell (thin text + a script bundle);
  // the real content only exists after JS runs, which the render service supplies.
  const SHELL = '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const RENDERED = '<html><body><h1>Rendered Heading</h1><p>Real content that only exists after JavaScript runs on this SPA.</p></body></html>';

  /** Stub fetch, routing the render service's /content endpoint to `renderedHtml` and every other
   *  URL to `plainHtml`; records whether /content was hit and with what URL/body. */
  function stubFetchWithRender(plainHtml: string, renderedHtml: string, plainStatus = 200): { hits: () => { url: string; body: string } | null } {
    let hit: { url: string; body: string } | null = null;
    injectGlobal(vm.ctx, 'fetch', ((url: string, options?: { body?: string }) => {
      if (url.includes('/content')) {
        hit = { url, body: options?.body ?? '' };
        return Promise.resolve({ ok: true, status: 200, text: () => renderedHtml, json: () => ({}) });
      }
      return Promise.resolve({ ok: plainStatus < 400, status: plainStatus, text: () => plainHtml, json: () => ({}) });
    }) as (...a: unknown[]) => unknown);
    return { hits: () => hit };
  }

  it('render:"auto" falls back to the render service for a dynamic (JS-shell) page', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000', RENDER_SERVICE_TOKEN: 'tok' } } as unknown as (...a: unknown[]) => unknown);
    const rec = stubFetchWithRender(SHELL, RENDERED);
    const r = await evalAwaitDump(vm, `webFetch("http://spa.example")`) as { ok: boolean; content: string; rendered?: boolean };
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(true);
    expect(r.content).toContain('Rendered Heading');
    expect(r.content).toContain('Real content');
    // Rendered through /content with the token, posting the requested URL.
    expect(rec.hits()?.url).toBe('http://render.local:3000/content?token=tok');
    expect(rec.hits()?.body).toContain('http://spa.example');
  });

  it('render:"auto" renders a data-injection page (thin text, inline-script-dominant)', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000', RENDER_SERVICE_TOKEN: 'tok' } } as unknown as (...a: unknown[]) => unknown);
    // ~90 chars of chrome text + a large inline data script that JS renders into the DOM
    // (mirrors quotes.toscrape.com/js/) — no SPA-root marker, yet clearly client-rendered.
    const dataPage =
      '<!doctype html><html><body><h1>Quotes to Scrape</h1><a>Login</a><footer>Made by Zyte</footer>' +
      '<script>var data=[' + '{"t":"a very long quote payload that dwarfs the visible chrome text"},'.repeat(30) + '];renderQuotes(data);</script>' +
      '</body></html>';
    const rec = stubFetchWithRender(dataPage, RENDERED);
    const r = await evalAwaitDump(vm, `webFetch("http://data.example")`) as { ok: boolean; content: string; rendered?: boolean };
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(true);
    expect(r.content).toContain('Rendered Heading');
    expect(rec.hits()).not.toBeNull();
  });

  it('render:"auto" does NOT render a content-rich static page', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000' } } as unknown as (...a: unknown[]) => unknown);
    const rec = stubFetchWithRender(HTML, RENDERED);
    const r = await evalAwaitDump(vm, `webFetch("http://x")`) as { ok: boolean; content: string; rendered?: boolean };
    expect(r.ok).toBe(true);
    expect(r.rendered).toBeFalsy();
    expect(r.content).toContain('First para.'); // plain content, not the rendered fixture
    expect(rec.hits()).toBeNull(); // render service never called
  });

  it('render:"off" never calls the render service, even for a dynamic page', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000' } } as unknown as (...a: unknown[]) => unknown);
    const rec = stubFetchWithRender(SHELL, RENDERED);
    const r = await evalAwaitDump(vm, `webFetch("http://spa.example", { render: "off" })`) as { ok: boolean; rendered?: boolean };
    expect(r.ok).toBe(true);
    expect(r.rendered).toBeFalsy();
    expect(rec.hits()).toBeNull();
  });

  it('render:"force" renders even a content-rich static page', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000' } } as unknown as (...a: unknown[]) => unknown);
    const rec = stubFetchWithRender(HTML, RENDERED);
    const r = await evalAwaitDump(vm, `webFetch("http://x", { render: "force" })`) as { content: string; rendered?: boolean };
    expect(r.rendered).toBe(true);
    expect(r.content).toContain('Rendered Heading');
    expect(rec.hits()).not.toBeNull();
  });

  it('render:"auto" degrades gracefully to the plain fetch when RENDER_SERVICE_URL is unset', async () => {
    injectGlobal(vm.ctx, 'process', { env: {} } as unknown as (...a: unknown[]) => unknown);
    const rec = stubFetchWithRender(SHELL, RENDERED);
    const r = await evalAwaitDump(vm, `webFetch("http://spa.example")`) as { ok: boolean; rendered?: boolean };
    expect(r.ok).toBe(true); // no throw despite the missing env
    expect(r.rendered).toBeFalsy();
    expect(rec.hits()).toBeNull();
  });

  it('render:"auto" falls back to the render service on a 403 bot-wall', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000' } } as unknown as (...a: unknown[]) => unknown);
    const rec = stubFetchWithRender('Forbidden', RENDERED, 403);
    const r = await evalAwaitDump(vm, `webFetch("http://blocked.example")`) as { ok: boolean; content: string; rendered?: boolean };
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(true);
    expect(r.content).toContain('Rendered Heading');
    expect(rec.hits()).not.toBeNull();
  });
});

describe('system/web webSearch function (DuckDuckGo fallback)', () => {
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sysweb-search-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: dir });
    const [web] = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'system-global')]);
    injectFunctions(vm, web!.functions);
  });

  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
    delete process.env['TAVILY_API_KEY'];
  });

  // A DuckDuckGo HTML-lite results fragment: one result wrapped in the `/l/?uddg=`
  // redirect (must be decoded to recover the real target), with a title and snippet.
  const DDG_HTML = `
    <div class="result results_links">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle&amp;rut=abc">Example Article Title</a>
      <a class="result__snippet">A short snippet about the article.</a>
    </div>
  `;

  it('falls back to DuckDuckGo when TAVILY_API_KEY is unset, decoding the redirect URL', async () => {
    delete process.env['TAVILY_API_KEY'];
    injectGlobal(vm.ctx, 'fetch', ((_url: string) =>
      Promise.resolve({ ok: true, status: 200, text: () => DDG_HTML, json: () => ({}) })) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query")`) as {
      ok: boolean;
      results: Array<{ title: string; url: string; snippet: string }>;
    };
    expect(r.ok).toBe(true);
    expect(r.results.length).toBe(1);
    expect(r.results[0]!.title).toBe('Example Article Title');
    expect(r.results[0]!.url).toBe('https://example.com/article');
    expect(r.results[0]!.snippet).toContain('short snippet');
  });

  it('uses Tavily when the key is set (provider: "auto" default)', async () => {
    // `process.env` inside the VM is a snapshot taken when injectHostTools ran (in
    // beforeEach) — mutating the host's real process.env now wouldn't propagate.
    // Override the VM's `process` global directly instead.
    injectGlobal(vm.ctx, 'process', { env: { TAVILY_API_KEY: 'test-key' } } as unknown as (...a: unknown[]) => unknown);
    let calledUrl = '';
    injectGlobal(vm.ctx, 'fetch', ((url: string) => {
      calledUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => '',
        json: () => ({ query: 'q', answer: 'tavily answer', results: [] }),
      });
    }) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query")`) as { ok: boolean; answer: string };
    expect(calledUrl).toBe('https://api.tavily.com/search');
    expect(r.ok).toBe(true);
    expect(r.answer).toBe('tavily answer');
  });

  it('provider: "duckduckgo" forces the scrape even when a Tavily key is set', async () => {
    process.env['TAVILY_API_KEY'] = 'test-key';
    let calledUrl = '';
    injectGlobal(vm.ctx, 'fetch', ((url: string) => {
      calledUrl = url;
      return Promise.resolve({ ok: true, status: 200, text: () => DDG_HTML, json: () => ({}) });
    }) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query", { provider: "duckduckgo" })`) as { ok: boolean };
    expect(calledUrl).toContain('html.duckduckgo.com');
    expect(r.ok).toBe(true);
  });

  // Rendered-Bing fragment: a `ck/a?…&u=a1<base64url>` redirect result (real target must be
  // base64url-decoded), a direct-href result, and an internal bing.com link that must be skipped.
  const BING_HTML = `
    <ol id="b_results">
      <li class="b_algo" data-id="1"><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9hbHBoYQ&amp;ntb=1">Alpha Result Title</a></h2><div class="b_caption"><p class="b_lineclamp2">Alpha snippet text about the topic.</p></div></li>
      <li class="b_algo" data-id="2"><h2><a href="https://beta.org/page">Beta Direct Title</a></h2><p>Beta snippet.</p></li>
      <li class="b_algo"><h2><a href="https://www.bing.com/search?q=more">Bing Internal</a></h2><p>skip me</p></li>
    </ol>
  `;

  it('provider: "bing" renders via RENDER_SERVICE_URL, parses results, decodes ck/a redirects, skips internal links', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000', RENDER_SERVICE_TOKEN: 'tok' } } as unknown as (...a: unknown[]) => unknown);
    let calledUrl = '';
    let calledBody = '';
    injectGlobal(vm.ctx, 'fetch', ((url: string, options: { body?: string }) => {
      calledUrl = url;
      calledBody = options?.body ?? '';
      return Promise.resolve({ ok: true, status: 200, text: () => BING_HTML, json: () => ({}) });
    }) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query", { provider: "bing", maxResults: 5 })`) as {
      ok: boolean;
      results: Array<{ title: string; url: string; snippet: string }>;
    };
    // Request went to the render service's /content with the token, posting the Bing URL.
    expect(calledUrl).toBe('http://render.local:3000/content?token=tok');
    expect(calledBody).toContain('https://www.bing.com/search');
    expect(r.ok).toBe(true);
    expect(r.results.length).toBe(2); // internal bing.com link skipped
    expect(r.results[0]!.title).toBe('Alpha Result Title');
    expect(r.results[0]!.url).toBe('https://example.com/alpha'); // u=a1<base64url> decoded
    expect(r.results[0]!.snippet).toContain('Alpha snippet');
    expect(r.results[1]!.url).toBe('https://beta.org/page'); // direct href
  });

  it('provider: "auto" uses Bing (not DuckDuckGo) when no Tavily key but RENDER_SERVICE_URL is set', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000' } } as unknown as (...a: unknown[]) => unknown);
    let hitDdg = false;
    injectGlobal(vm.ctx, 'fetch', ((url: string) => {
      if (url.includes('duckduckgo')) hitDdg = true;
      const body = url.includes('/content') ? BING_HTML : DDG_HTML;
      return Promise.resolve({ ok: true, status: 200, text: () => body, json: () => ({}) });
    }) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query")`) as { ok: boolean; results: Array<{ url: string }> };
    expect(r.ok).toBe(true);
    expect(r.results[0]!.url).toBe('https://example.com/alpha'); // Bing result
    expect(hitDdg).toBe(false);
  });

  it('provider: "auto" falls through to DuckDuckGo when Bing renders no results', async () => {
    injectGlobal(vm.ctx, 'process', { env: { RENDER_SERVICE_URL: 'http://render.local:3000' } } as unknown as (...a: unknown[]) => unknown);
    injectGlobal(vm.ctx, 'fetch', ((url: string) => {
      const body = url.includes('/content') ? '<html><body>No results found.</body></html>' : DDG_HTML;
      return Promise.resolve({ ok: true, status: 200, text: () => body, json: () => ({}) });
    }) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query")`) as { ok: boolean; results: Array<{ url: string }> };
    expect(r.ok).toBe(true);
    expect(r.results[0]!.url).toBe('https://example.com/article'); // DDG fallback result
  });

  it('provider: "bing" returns ok:false when RENDER_SERVICE_URL is unset', async () => {
    injectGlobal(vm.ctx, 'process', { env: {} } as unknown as (...a: unknown[]) => unknown);
    injectGlobal(vm.ctx, 'fetch', (() =>
      Promise.resolve({ ok: true, status: 200, text: () => BING_HTML, json: () => ({}) })) as (...a: unknown[]) => unknown);

    const r = await evalAwaitDump(vm, `webSearch("test query", { provider: "bing" })`) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('RENDER_SERVICE_URL');
  });
});

describe('system/todo functions', () => {
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    logs.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'systodo-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: dir });
    injectGlobal(vm.ctx, 'display', ((d: unknown) => host.display(d)) as (...a: unknown[]) => unknown);
    const [todo] = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'system-global')]);
    injectFunctions(vm, todo!.functions);
  });

  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('todoWrite renders a checklist and todoRead returns it', () => {
    const w = evalDump(vm, `todoWrite([{ content: "step one", status: "in_progress" }, { content: "step two", status: "pending" }])`) as { ok: boolean; count: number };
    expect(w.count).toBe(2);
    // display() was called with a rendered checklist
    expect(logs.some((l) => l.startsWith('display:') && l.includes('[~] step one'))).toBe(true);
    const r = evalDump(vm, `todoRead()`) as { items: Array<{ content: string; status: string }> };
    expect(r.items.length).toBe(2);
    expect(r.items[0]!.status).toBe('in_progress');
  });
});
