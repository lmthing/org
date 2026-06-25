import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectHostTools } from './host-tools.js';
import type { RenderHost } from '../session/types.js';

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

describe('injectHostTools — fetch', () => {
  it('returns ok:false (does not hang) when the connection is refused', async () => {
    const vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp' });
    // Port 1 is reserved and refuses fast; with the curl --max-time guard a hung
    // endpoint can no longer block the thread forever (stopgap until the Wave-2
    // async client lands). This proves the error path returns a value, not a hang.
    const started = Date.now();
    const r = evalDump(vm, `fetch("http://127.0.0.1:1/")`) as { ok: boolean; status: number };
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(31000);
    vm.dispose();
  });
});
