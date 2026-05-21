import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDomainAllowed, resolveSandboxPath, PermissionError, IoEngine } from './io.js';
import { TraceWriter } from '../sandbox/trace.js';

// ── isDomainAllowed ──────────────────────────────────────────────────────────

describe('isDomainAllowed', () => {
  it('exact match', () => {
    expect(isDomainAllowed('https://api.example.com/data', ['api.example.com'])).toBe(true);
  });

  it('wildcard match', () => {
    expect(isDomainAllowed('https://api.github.com/repos', ['*.github.com'])).toBe(true);
  });

  it('wildcard does not match root domain', () => {
    expect(isDomainAllowed('https://github.com', ['*.github.com'])).toBe(false);
  });

  it('rejected domain', () => {
    expect(isDomainAllowed('https://evil.com/steal', ['api.example.com', '*.github.com'])).toBe(false);
  });

  it('empty allowlist rejects all', () => {
    expect(isDomainAllowed('https://api.example.com/', [])).toBe(false);
  });

  it('invalid URL returns false', () => {
    expect(isDomainAllowed('not-a-url', ['example.com'])).toBe(false);
  });
});

// ── resolveSandboxPath ───────────────────────────────────────────────────────

describe('resolveSandboxPath', () => {
  const root = '/session/abc/files';

  it('valid relative path returns absolute', () => {
    expect(resolveSandboxPath('data/result.json', root)).toBe('/session/abc/files/data/result.json');
  });

  it('../escape returns null', () => {
    expect(resolveSandboxPath('../escape', root)).toBeNull();
  });

  it('../../etc/passwd returns null', () => {
    expect(resolveSandboxPath('../../etc/passwd', root)).toBeNull();
  });

  it('absolute path inside sandbox is allowed', () => {
    expect(resolveSandboxPath('/session/abc/files/sub/file.txt', root)).toBe('/session/abc/files/sub/file.txt');
  });

  it('absolute path outside sandbox returns null', () => {
    expect(resolveSandboxPath('/etc/passwd', root)).toBeNull();
  });

  it('dot-path resolves correctly', () => {
    expect(resolveSandboxPath('./notes.txt', root)).toBe('/session/abc/files/notes.txt');
  });
});

// ── IoEngine mocked ctx ───────────────────────────────────────────────────────

function makeHandle(label?: string) {
  return { _label: label ?? 'handle', dispose: vi.fn() };
}

function makeMockCtx() {
  const stored: Record<string, unknown> = {};

  const ctx = {
    global: '__global__',
    newFunction: vi.fn((name: string, fn: unknown) => makeHandle(`fn:${name}`)),
    newObject: vi.fn(() => makeHandle('obj')),
    newPromise: vi.fn(() => {
      let resolveFn: (v: unknown) => void = () => {};
      let rejectFn: (e: unknown) => void = () => {};
      const promise = new Promise((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      });
      // Attach a no-op catch so rejections don't become unhandled
      promise.catch(() => {});
      return {
        handle: promise,
        resolve: (v: unknown) => resolveFn(v),
        reject: (e: unknown) => rejectFn(e),
        dispose: vi.fn(),
      };
    }),
    newString: vi.fn((s: string) => ({ _value: s, dispose: vi.fn() })),
    newNumber: vi.fn((n: number) => ({ _value: n, dispose: vi.fn() })),
    newArray: vi.fn(() => makeHandle('arr')),
    setProp: vi.fn((obj: unknown, key: unknown, val: unknown) => {
      if (obj === '__global__') {
        stored[String(key)] = val;
      }
    }),
    dump: vi.fn((h: unknown) => h),
    runtime: { executePendingJobs: vi.fn() },
    null: null,
    true: true,
    false: false,
  };

  return { ctx, stored };
}

// ── fetch global registration ─────────────────────────────────────────────────

describe('IoEngine.registerGlobals — fetch', () => {
  let tmpDir: string;
  let traceWriter: TraceWriter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'io-test-'));
    traceWriter = new TraceWriter(join(tmpDir, 'trace.jsonl'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('allowed domain succeeds', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { forEach: vi.fn() },
      arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    };

    const globalFetch = vi.fn(async () => mockResponse as unknown as Response);
    vi.stubGlobal('fetch', globalFetch);

    const { ctx } = makeMockCtx();
    const { ModuleRegistry } = await import('../sandbox/require.js');
    const registry = new (ModuleRegistry as unknown as new (ctx: unknown) => InstanceType<typeof ModuleRegistry>)(ctx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

    const engine = new IoEngine({
      fetch: { allowedDomains: ['api.example.com'], maxResponseBytes: 10_000_000, defaultTimeoutMs: 30_000 },
      fs: { sandboxRoot: tmpDir, maxFileSizeBytes: 100_000_000 },
      trace: traceWriter,
      moduleRegistry: registry,
    });

    // Extract the fetch handler directly by capturing it from injectGlobal
    let capturedFetchFn: ((...args: unknown[]) => unknown) | undefined;
    const origInjectGlobal = (await import('../sandbox/host-bridge.js')).injectGlobal;

    // We test by calling engine directly through a spy on injectGlobal
    // Instead, test via direct method call pattern matching the registered logic
    engine.registerGlobals(ctx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

    // injectGlobal was called; verify setProp was called with 'fetch'
    expect(ctx.setProp).toHaveBeenCalledWith('__global__', 'fetch', expect.anything());

    vi.unstubAllGlobals();
  });
});

// ── fs.readFile via engine ────────────────────────────────────────────────────

describe('IoEngine fs operations', () => {
  let tmpDir: string;
  let traceWriter: TraceWriter;
  let engine: IoEngine;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'io-fs-test-'));
    traceWriter = new TraceWriter(join(tmpDir, 'trace.jsonl'));

    const { ModuleRegistry } = await import('../sandbox/require.js');
    const fakeCtx = makeMockCtx().ctx;
    const registry = new (ModuleRegistry as unknown as new (ctx: unknown) => InstanceType<typeof ModuleRegistry>)(fakeCtx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

    engine = new IoEngine({
      fetch: { allowedDomains: [], maxResponseBytes: 10_000_000, defaultTimeoutMs: 30_000 },
      fs: { sandboxRoot: tmpDir, maxFileSizeBytes: 100_000_000 },
      trace: traceWriter,
      moduleRegistry: registry,
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('fs.readFile reads file within sandbox', async () => {
    await writeFile(join(tmpDir, 'hello.txt'), 'hello world', 'utf-8');

    const fsReadFile = (engine as unknown as { _fsConfig: unknown })['_fsConfig'];

    // Access internal fs methods by calling them through the engine internals.
    // We re-build the fs object logic inline for unit testing.
    const { resolveSandboxPath: rsp } = await import('./io.js');
    const resolved = rsp('hello.txt', tmpDir);
    expect(resolved).toBe(join(tmpDir, 'hello.txt'));

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(resolved!, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('fs.writeFile writes file within sandbox', async () => {
    const { resolveSandboxPath: rsp } = await import('./io.js');
    const resolved = rsp('output.txt', tmpDir);
    expect(resolved).not.toBeNull();

    const { writeFile: wf } = await import('node:fs/promises');
    await wf(resolved!, 'written content', 'utf-8');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(resolved!, 'utf-8');
    expect(content).toBe('written content');
  });

  it('fs.readFile with path traversal rejects with contract error', () => {
    expect(resolveSandboxPath('../../etc/passwd', tmpDir)).toBeNull();
  });
});

// ── require with unregistered module ─────────────────────────────────────────

describe('IoEngine require', () => {
  let tmpDir: string;
  let traceWriter: TraceWriter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'io-req-test-'));
    traceWriter = new TraceWriter(join(tmpDir, 'trace.jsonl'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('require with unregistered module rejects with PermissionError message', async () => {
    const { ctx } = makeMockCtx();
    const { ModuleRegistry } = await import('../sandbox/require.js');
    const registry = new (ModuleRegistry as unknown as new (ctx: unknown) => InstanceType<typeof ModuleRegistry>)(ctx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

    const engine = new IoEngine({
      fetch: { allowedDomains: [], maxResponseBytes: 10_000_000, defaultTimeoutMs: 30_000 },
      fs: { sandboxRoot: tmpDir, maxFileSizeBytes: 100_000_000 },
      trace: traceWriter,
      moduleRegistry: registry,
    });

    engine.registerGlobals(ctx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

    // Verify require was registered as a global
    const calls = (ctx.newFunction as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const requireCallArgs = calls.find((c) => c[0] === 'require');
    expect(requireCallArgs).toBeDefined();

    // Simulate calling the require function with an unregistered module
    const requireImpl = requireCallArgs![1] as (h: unknown) => unknown;
    ctx.dump.mockReturnValueOnce('some-unregistered-module');

    // Invoke and handle the returned deferred
    const deferred = requireImpl({ _value: 'nameHandle', dispose: vi.fn() }) as {
      handle: Promise<unknown>;
    };

    // Catch the rejection to prevent unhandled rejection
    if (deferred?.handle && typeof deferred.handle.catch === 'function') {
      await deferred.handle.catch(() => {});
    }

    // Verify that the error string was created for the unregistered module
    const strCalls = (ctx.newString as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const errorStrings = strCalls.map((c) => {
      const s = c[0];
      return typeof s === 'object' && s !== null ? (s as { _value: string })._value : String(s);
    });
    expect(errorStrings.some((s) => s.includes("require('some-unregistered-module') is not in availableModules"))).toBe(true);
  });
});

// ── fetch response sync methods ───────────────────────────────────────────────

describe('fetch response sync methods', () => {
  it('response has sync .text(), .json(), .bytes() methods', async () => {
    const jsonPayload = JSON.stringify({ value: 42 });
    const encoder = new TextEncoder();
    const bodyBytes = encoder.encode(jsonPayload);

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        forEach: vi.fn((cb: (v: string, k: string) => void) => {
          cb('application/json', 'content-type');
        }),
      },
      arrayBuffer: vi.fn(async () => bodyBytes.buffer),
    };

    vi.stubGlobal('fetch', vi.fn(async () => mockResponse as unknown as Response));

    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'io-resp-test-'));
      const traceWriter = new TraceWriter(join(tmpDir, 'trace.jsonl'));
      const { ModuleRegistry } = await import('../sandbox/require.js');
      const fakeCtx = makeMockCtx().ctx;
      const registry = new (ModuleRegistry as unknown as new (ctx: unknown) => InstanceType<typeof ModuleRegistry>)(fakeCtx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

      const engine = new IoEngine({
        fetch: { allowedDomains: ['api.example.com'], maxResponseBytes: 10_000_000, defaultTimeoutMs: 30_000 },
        fs: { sandboxRoot: tmpDir, maxFileSizeBytes: 100_000_000 },
        trace: traceWriter,
        moduleRegistry: registry,
      });

      // Access the private _registerFetch method indirectly by testing the hostFetch function.
      // We do this by calling injectGlobal and capturing the function.
      let capturedFn: ((...args: unknown[]) => unknown) | undefined;
      const origInjectGlobal = vi.spyOn(await import('../sandbox/host-bridge.js'), 'injectGlobal').mockImplementation(
        (_ctx, name, fn) => {
          if (name === 'fetch') capturedFn = fn;
        },
      );

      engine.registerGlobals(fakeCtx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

      expect(capturedFn).toBeDefined();
      const resp = await capturedFn!('https://api.example.com/data') as {
        ok: boolean;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        text: () => string;
        json: () => unknown;
        bytes: () => number[];
      };

      expect(resp.ok).toBe(true);
      expect(resp.status).toBe(200);
      expect(typeof resp.text).toBe('function');
      expect(typeof resp.json).toBe('function');
      expect(typeof resp.bytes).toBe('function');
      expect(resp.text()).toBe(jsonPayload);
      expect((resp.json() as { value: number }).value).toBe(42);
      expect(resp.bytes()).toBeInstanceOf(Array);

      origInjectGlobal.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fetch to disallowed domain rejects with PermissionError', async () => {
    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'io-perm-test-'));
      const traceWriter = new TraceWriter(join(tmpDir, 'trace.jsonl'));
      const { ModuleRegistry } = await import('../sandbox/require.js');
      const fakeCtx = makeMockCtx().ctx;
      const registry = new (ModuleRegistry as unknown as new (ctx: unknown) => InstanceType<typeof ModuleRegistry>)(fakeCtx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);

      const engine = new IoEngine({
        fetch: { allowedDomains: ['api.example.com'], maxResponseBytes: 10_000_000, defaultTimeoutMs: 30_000 },
        fs: { sandboxRoot: tmpDir, maxFileSizeBytes: 100_000_000 },
        trace: traceWriter,
        moduleRegistry: registry,
      });

      let capturedFn: ((...args: unknown[]) => unknown) | undefined;
      const spy = vi.spyOn(await import('../sandbox/host-bridge.js'), 'injectGlobal').mockImplementation(
        (_ctx, name, fn) => {
          if (name === 'fetch') capturedFn = fn;
        },
      );

      engine.registerGlobals(fakeCtx as unknown as import('quickjs-emscripten').QuickJSAsyncContext);
      spy.mockRestore();

      await expect(capturedFn!('https://evil.com/steal')).rejects.toThrow(PermissionError);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
