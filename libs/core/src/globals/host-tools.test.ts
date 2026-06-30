import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectHostTools } from './host-tools.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { createFetchGlobal } from './fetch.js';
import { resolveFetchYield } from '../eval/fetch-yield.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { MessageHistory } from '../context/history.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession, StreamOpts } from '../eval/stream-types.js';
import type { YieldRequest } from '../eval/yield.js';

const silentHost: RenderHost = {
  display: () => {},
  ask: async () => undefined,
  log: () => {},
};

/** Eval an expression in the VM and dump the result back to the host. */
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

describe('injectHostTools — readFileRaw / writeFileRaw', () => {
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp/space' });
    dir = mkdtempSync(join(tmpdir(), 'host-tools-'));
  });

  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads an existing file with line count', () => {
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'line1\nline2\nline3');
    const r = evalDump(vm, `readFileRaw(${JSON.stringify(p)})`) as { ok: boolean; content: string; lines: number };
    expect(r.ok).toBe(true);
    expect(r.content).toBe('line1\nline2\nline3');
    expect(r.lines).toBe(3);
  });

  it('returns error for a missing file', () => {
    const r = evalDump(vm, `readFileRaw(${JSON.stringify(join(dir, 'nope.txt'))})`) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('refuses binary files', () => {
    const p = join(dir, 'bin.dat');
    writeFileSync(p, Buffer.from([0x41, 0x00, 0x42, 0x00]));
    const r = evalDump(vm, `readFileRaw(${JSON.stringify(p)})`) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toBe('binary file');
  });

  it('applies offset/limit on line boundaries', () => {
    const p = join(dir, 'lines.txt');
    writeFileSync(p, 'a\nb\nc\nd\ne');
    const r = evalDump(vm, `readFileRaw(${JSON.stringify(p)}, { offset: 1, limit: 2 })`) as { content: string };
    expect(r.content).toBe('b\nc');
  });

  it('round-trips arbitrary content with quotes and newlines (no shell quoting)', () => {
    const p = join(dir, 'tricky.txt');
    const content = `He said "hi"\nand 'bye'\n$VAR \`backtick\` ; rm -rf /\n`;
    const w = evalDump(vm, `writeFileRaw(${JSON.stringify(p)}, ${JSON.stringify(content)})`) as { ok: boolean };
    expect(w.ok).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe(content);
    const r = evalDump(vm, `readFileRaw(${JSON.stringify(p)})`) as { content: string };
    expect(r.content).toBe(content);
  });

  it('creates parent directories on write', () => {
    const p = join(dir, 'nested', 'deep', 'f.txt');
    const w = evalDump(vm, `writeFileRaw(${JSON.stringify(p)}, "hi")`) as { ok: boolean; bytes: number };
    expect(w.ok).toBe(true);
    expect(w.bytes).toBe(2);
    expect(readFileSync(p, 'utf8')).toBe('hi');
  });
});

describe('injectHostTools — relative paths resolve against the space dir', () => {
  // Regression: a fork that writes a RELATIVE work/candidate.ts while execShell
  // runs with cwd = spaceDir. Relative paths must resolve against the
  // space dir (not process.cwd()) so the file written is the file run.
  let vm: VM;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'host-tools-space-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: dir });
  });
  afterEach(() => {
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writeFileRaw resolves a relative path under the space dir', () => {
    const w = evalDump(vm, `writeFileRaw("work/candidate.ts", "export const x = 1;")`) as { ok: boolean };
    expect(w.ok).toBe(true);
    expect(readFileSync(join(dir, 'work', 'candidate.ts'), 'utf8')).toBe('export const x = 1;');
  });

  it('readFileRaw reads back a relative path written relative — round-trip under the space dir', () => {
    evalDump(vm, `writeFileRaw("nested/file.txt", "hello")`);
    const r = evalDump(vm, `readFileRaw("nested/file.txt")`) as { ok: boolean; content: string };
    expect(r.ok).toBe(true);
    expect(r.content).toBe('hello');
  });

  it('absolute paths are left untouched (not re-rooted under the space dir)', () => {
    const abs = join(dir, 'abs.txt');
    const w = evalDump(vm, `writeFileRaw(${JSON.stringify(abs)}, "abs")`) as { ok: boolean };
    expect(w.ok).toBe(true);
    expect(readFileSync(abs, 'utf8')).toBe('abs');
  });

  it('execShell runs with cwd = space dir, so a written relative file is runnable', () => {
    // Regression: execShell used to run at process.cwd(), so writeFile("x") then
    // execShell("cat x") disagreed on the path. Both must root at the space dir.
    evalDump(vm, `writeFileRaw("hello.txt", "world")`);
    const r = evalDump(vm, `execShell("cat hello.txt")`) as { ok: boolean; stdout: string };
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe('world');
    // pwd should report the space dir itself.
    const pwd = evalDump(vm, `execShell("pwd")`) as { stdout: string };
    expect(pwd.stdout.trim()).toBe(dir);
  });
});

describe('injectHostTools — process.env and read-only profile', () => {
  it('exposes LMTHING_SPACE_DIR in process.env', async () => {
    const vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/my/space/dir' });
    const v = evalDump(vm, `process.env['LMTHING_SPACE_DIR']`);
    expect(v).toBe('/my/space/dir');
    vm.dispose();
  });

  it('read-only profile blocks writeFileRaw', async () => {
    const vm = await createVM();
    const dir = mkdtempSync(join(tmpdir(), 'host-ro-'));
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp', profile: { allowWrite: false } });
    const r = evalDump(vm, `writeFileRaw(${JSON.stringify(join(dir, 'x.txt'))}, "data")`) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/read-only/);
    vm.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('read-only profile blocks mutating shell commands but allows reads', async () => {
    const vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp', profile: { allowWrite: false } });
    const blocked = evalDump(vm, `execShell("rm -rf /tmp/whatever")`) as { ok: boolean; stderr: string };
    expect(blocked.ok).toBe(false);
    expect(blocked.stderr).toMatch(/read-only/);
    const allowed = evalDump(vm, `execShell("echo hello")`) as { ok: boolean; stdout: string };
    expect(allowed.ok).toBe(true);
    expect(allowed.stdout.trim()).toBe('hello');
    vm.dispose();
  });
});

describe('injectHostTools — execShell exitCode', () => {
  let vm: VM;
  beforeEach(async () => {
    vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp' });
  });
  afterEach(() => vm.dispose());

  it('returns exitCode 0 on success', () => {
    const r = evalDump(vm, `execShell("true")`) as { ok: boolean; exitCode: number };
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('surfaces a non-zero exit code (distinguishes failure modes)', () => {
    const r = evalDump(vm, `execShell("exit 3")`) as { ok: boolean; exitCode: number };
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(3);
  });

  it('reports 127 for command-not-found', () => {
    const r = evalDump(vm, `execShell("this_command_does_not_exist_xyz")`) as { exitCode: number };
    expect(r.exitCode).toBe(127);
  });

  it('honors a per-call timeout override (slow command is killed)', () => {
    const r = evalDump(vm, `execShell("sleep 2", { timeout: 100 })`) as { ok: boolean; exitCode: number };
    expect(r.ok).toBe(false); // killed by the 100ms timeout, not run to completion
  });

  it('read-only block reports exitCode 126', async () => {
    const ro = await createVM();
    injectHostTools(ro, { renderHost: silentHost, spaceDir: '/tmp', profile: { allowWrite: false } });
    const r = evalDump(ro, `execShell("rm -rf /tmp/x")`) as { ok: boolean; exitCode: number };
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(126);
    ro.dispose();
  });
});

/** A streamFn that emits `statements` on the first turn, then nothing (so the loop ends). */
function scriptedStream(statements: string): (opts: StreamOpts) => Promise<StreamSession> {
  let calls = 0;
  return async () => {
    const text = calls++ === 0 ? statements : '';
    let aborted = false;
    async function* gen() { if (!aborted && text) yield text; }
    return { textStream: gen(), abort() { aborted = true; } } as StreamSession;
  };
}

function readGlobal(vm: VM, name: string): unknown {
  const h = vm.ctx.getProp(vm.ctx.global, name);
  try { return vm.ctx.dump(h); } finally { h.dispose(); }
}

describe('fetch — real async yield (replaces execSync(curl))', () => {
  it('returns ok:false (does not hang) when the connection is refused', async () => {
    const vm = await createVM();
    const pushYield = (req: YieldRequest) => { vm.pendingYields.push(req); };
    injectGlobal(vm.ctx, 'fetch', createFetchGlobal(pushYield) as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const started = Date.now();
    const result = await runTurnLoop({
      vm, history, systemBlock: 'test',
      ambientDts: 'declare function fetch(url: string, opts?: unknown): Promise<{ ok: boolean; status: number }>;',
      renderHost: silentHost,
      // Port 1 is reserved and refuses fast.
      streamFn: scriptedStream('const r = await fetch("http://127.0.0.1:1/");'),
      processYield: async (req) => {
        const [url, opts] = req.args as [string, undefined];
        return resolveFetchYield(url, opts);
      },
      maxRetries: 2,
    });

    expect(result).toBe('done');
    expect(readGlobal(vm, 'r')).toMatchObject({ ok: false, status: 0 });
    expect(Date.now() - started).toBeLessThan(31000);
    vm.dispose();
  });

  it('resolves two concurrent fetches without serializing — proves the event loop is not blocked', async () => {
    // A local server that records each request's ARRIVAL time, then delays its
    // response. If fetch blocked the thread (the old execSync(curl) behavior), the
    // second request could not even arrive until the first's response was fully
    // read; resolved concurrently, both arrive within milliseconds of each other.
    const arrivals: number[] = [];
    const server: Server = createServer((_req, res) => {
      arrivals.push(Date.now());
      setTimeout(() => { res.end('ok'); }, 150);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const vm = await createVM();
    const pushYield = (req: YieldRequest) => { vm.pendingYields.push(req); };
    injectGlobal(vm.ctx, 'fetch', createFetchGlobal(pushYield) as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    // A host-side timer that should fire WHILE both fetches are in flight — proving
    // the Node thread keeps running other work instead of blocking on the request.
    let timerFiredDuringFetch = false;
    const timer = setTimeout(() => { timerFiredDuringFetch = true; }, 50);

    try {
      const result = await runTurnLoop({
        vm, history, systemBlock: 'test',
        ambientDts: 'declare function fetch(url: string, opts?: unknown): Promise<{ ok: boolean; status: number }>;',
        renderHost: silentHost,
        streamFn: scriptedStream(
          `const [a, b] = await Promise.all([fetch("http://127.0.0.1:${port}/"), fetch("http://127.0.0.1:${port}/")]);`,
        ),
        processYield: async (req) => {
          const [url, opts] = req.args as [string, undefined];
          return resolveFetchYield(url, opts);
        },
        maxRetries: 2,
      });

      expect(result).toBe('done');
      expect(readGlobal(vm, 'a')).toMatchObject({ ok: true, status: 200 });
      expect(readGlobal(vm, 'b')).toMatchObject({ ok: true, status: 200 });
      expect(arrivals.length).toBe(2);
      // Both requests reached the server within a tight window of each other —
      // serialized, the second couldn't arrive until ~150ms after the first.
      expect(Math.abs(arrivals[1]! - arrivals[0]!)).toBeLessThan(100);
      expect(timerFiredDuringFetch).toBe(true);
    } finally {
      clearTimeout(timer);
      vm.dispose();
      server.close();
    }
  });
});
