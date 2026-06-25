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
    '<p>First para.</p><p>Second &lt;para&gt;.</p></body></html>';

  /** Override the host fetch with a stub returning fixed HTML. */
  function stubFetch(htmlBody: string): void {
    injectGlobal(vm.ctx, 'fetch', ((_url: string) => ({
      ok: true,
      status: 200,
      text: () => htmlBody,
      json: () => ({}),
    })) as (...a: unknown[]) => unknown);
  }

  it('strips tags/script/style and decodes entities by default', () => {
    stubFetch(HTML);
    const r = evalDump(vm, `webFetch("http://x")`) as { ok: boolean; content: string };
    expect(r.ok).toBe(true);
    expect(r.content).toContain('Hello & welcome');
    expect(r.content).toContain('First para.');
    expect(r.content).toContain('Second <para>.');
    expect(r.content).not.toContain('<p>');
    expect(r.content).not.toContain('var x=1'); // script body dropped
    expect(r.content).not.toContain('color:red'); // style body dropped
  });

  it('returns raw HTML when format:"html"', () => {
    stubFetch(HTML);
    const r = evalDump(vm, `webFetch("http://x", { format: "html" })`) as { content: string };
    expect(r.content).toContain('<p>First para.</p>');
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
