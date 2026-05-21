import { resolve, relative, isAbsolute } from 'node:path';
import {
  readFile as nodeReadFile,
  writeFile as nodeWriteFile,
  readdir,
  access,
  rm as nodeRm,
  stat as nodeStat,
  mkdir,
} from 'node:fs/promises';
import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import { TraceWriter } from '../sandbox/trace.js';
import { ModuleRegistry } from '../sandbox/require.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';

export interface FetchConfig {
  allowedDomains: string[];
  maxResponseBytes: number;
  defaultTimeoutMs: number;
}

export interface FsConfig {
  sandboxRoot: string;
  maxFileSizeBytes: number;
}

export class PermissionError extends Error {
  readonly kind = 'permission' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  for (const pattern of allowedDomains) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      if (hostname.endsWith('.' + suffix)) {
        return true;
      }
    } else {
      if (hostname === pattern) {
        return true;
      }
    }
  }

  return false;
}

export function resolveSandboxPath(userPath: string, sandboxRoot: string): string | null {
  let resolved: string;

  if (isAbsolute(userPath)) {
    resolved = userPath;
  } else {
    resolved = resolve(sandboxRoot, userPath);
  }

  const rel = relative(sandboxRoot, resolved);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }

  return resolved;
}

export class IoEngine {
  private readonly _fetchConfig: FetchConfig;
  private readonly _fsConfig: FsConfig;
  private readonly _trace: TraceWriter;
  private readonly _moduleRegistry: ModuleRegistry;

  constructor(opts: {
    fetch: FetchConfig;
    fs: FsConfig;
    trace: TraceWriter;
    moduleRegistry: ModuleRegistry;
  }) {
    this._fetchConfig = opts.fetch;
    this._fsConfig = opts.fs;
    this._trace = opts.trace;
    this._moduleRegistry = opts.moduleRegistry;
  }

  registerGlobals(ctx: QuickJSAsyncContext): void {
    this._registerFetch(ctx);
    this._registerFs(ctx);
    this._registerRequire(ctx);
  }

  private _registerFetch(ctx: QuickJSAsyncContext): void {
    const fetchConfig = this._fetchConfig;

    const hostFetch = async (url: unknown, init?: unknown): Promise<unknown> => {
      const urlStr = String(url);

      if (!isDomainAllowed(urlStr, fetchConfig.allowedDomains)) {
        let domain: string;
        try {
          domain = new URL(urlStr).hostname;
        } catch {
          domain = urlStr;
        }
        throw new PermissionError(`fetch to '${domain}' is not allowed`);
      }

      const initObj = (init && typeof init === 'object' ? init : {}) as Record<string, unknown>;
      const controller = new AbortController();
      const timeoutMs = fetchConfig.defaultTimeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let signal = controller.signal;
      if (initObj['signal'] instanceof AbortSignal) {
        signal = initObj['signal'];
      }

      let response: Response;
      try {
        response = await fetch(urlStr, {
          method: initObj['method'] as string | undefined,
          headers: initObj['headers'] as HeadersInit | undefined,
          body: initObj['body'] as BodyInit | undefined,
          signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer.slice(0, fetchConfig.maxResponseBytes));
      const decoder = new TextDecoder();
      const textBody = decoder.decode(bytes);

      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        text: () => textBody,
        json: () => JSON.parse(textBody) as unknown,
        bytes: () => Array.from(bytes),
      };
    };

    injectGlobal(ctx, 'fetch', hostFetch as (...args: unknown[]) => unknown);
  }

  private _registerFs(ctx: QuickJSAsyncContext): void {
    const { sandboxRoot, maxFileSizeBytes } = this._fsConfig;

    const checkPath = (userPath: unknown): string => {
      const resolved = resolveSandboxPath(String(userPath), sandboxRoot);
      if (resolved === null) {
        throw Object.assign(new Error(`path traversal blocked: ${String(userPath)}`), {
          kind: 'contract',
        });
      }
      return resolved;
    };

    const fsObj = {
      readFile: async (userPath: unknown, encoding?: unknown): Promise<unknown> => {
        const resolved = checkPath(userPath);
        const raw = await nodeReadFile(resolved);
        if (raw.byteLength > maxFileSizeBytes) {
          throw new Error(`file exceeds maxFileSizeBytes (${maxFileSizeBytes})`);
        }
        if (encoding === 'utf-8' || encoding === 'utf8') {
          return raw.toString('utf-8');
        }
        return Array.from(raw);
      },
      writeFile: async (userPath: unknown, content: unknown): Promise<void> => {
        const resolved = checkPath(userPath);
        await mkdir(resolve(resolved, '..'), { recursive: true });
        if (typeof content === 'string') {
          await nodeWriteFile(resolved, content, 'utf-8');
        } else if (Array.isArray(content)) {
          await nodeWriteFile(resolved, Buffer.from(content as number[]));
        } else {
          await nodeWriteFile(resolved, String(content), 'utf-8');
        }
        this._trace.write({ type: 'file_write', path: resolved });
      },
      readDir: async (userPath: unknown): Promise<string[]> => {
        const resolved = checkPath(userPath);
        return readdir(resolved);
      },
      exists: async (userPath: unknown): Promise<boolean> => {
        const resolved = checkPath(userPath);
        try {
          await access(resolved);
          return true;
        } catch {
          return false;
        }
      },
      rm: async (userPath: unknown): Promise<void> => {
        const resolved = checkPath(userPath);
        await nodeRm(resolved, { recursive: true, force: true });
      },
      stat: async (userPath: unknown): Promise<{ size: number; mtime: string }> => {
        const resolved = checkPath(userPath);
        const s = await nodeStat(resolved);
        return { size: s.size, mtime: s.mtime.toISOString() };
      },
    };

    const fsHandle = ctx.newObject();

    for (const [key, fn] of Object.entries(fsObj)) {
      const wrappedFn = fn as (...args: unknown[]) => Promise<unknown>;
      const fnHandle = ctx.newFunction(key, (...argHandles) => {
        const args = argHandles.map((h) => ctx.dump(h));
        const result = wrappedFn(...args);
        const deferred = ctx.newPromise();
        result
          .then((v) => {
            const handle = marshalToQuickJS(ctx, v);
            deferred.resolve(handle);
            handle.dispose();
            ctx.runtime.executePendingJobs();
          })
          .catch((err: unknown) => {
            const errHandle = ctx.newString(
              err instanceof Error ? err.message : String(err),
            );
            deferred.reject(errHandle);
            errHandle.dispose();
            ctx.runtime.executePendingJobs();
          });
        return deferred.handle;
      });
      ctx.setProp(fsHandle, key, fnHandle);
      fnHandle.dispose();
    }

    ctx.setProp(ctx.global, 'fs', fsHandle);
    fsHandle.dispose();
  }

  private _registerRequire(ctx: QuickJSAsyncContext): void {
    const registry = this._moduleRegistry;

    const requireFn = ctx.newFunction('require', (nameHandle) => {
      const name = ctx.dump(nameHandle) as string;

      const registered = (registry as unknown as { modules: Map<string, unknown> }).modules;
      if (registered && registered.has(name)) {
        const deferred = ctx.newPromise();
        const handle = marshalToQuickJS(ctx, registered.get(name));
        deferred.resolve(handle);
        handle.dispose();
        ctx.runtime.executePendingJobs();
        return deferred.handle;
      }

      const deferred = ctx.newPromise();
      const errHandle = ctx.newString(`PermissionError: require('${name}') is not in availableModules`);
      deferred.reject(errHandle);
      errHandle.dispose();
      ctx.runtime.executePendingJobs();
      return deferred.handle;
    });

    ctx.setProp(ctx.global, 'require', requireFn);
    requireFn.dispose();
  }
}
