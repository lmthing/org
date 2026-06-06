/**
 * QuickJS context lifecycle manager.
 * Singleton WASM module, one async context per session.
 */
import {
  newQuickJSAsyncWASMModule,
  type QuickJSAsyncWASMModule,
  type QuickJSAsyncContext,
  type QuickJSAsyncRuntime,
} from 'quickjs-emscripten';

// ── Singleton module ──

let _module: QuickJSAsyncWASMModule | null = null;
let _modulePromise: Promise<QuickJSAsyncWASMModule> | null = null;

export async function getQuickJSModule(): Promise<QuickJSAsyncWASMModule> {
  if (_module) return _module;
  if (_modulePromise) return _modulePromise;
  _modulePromise = newQuickJSAsyncWASMModule().then((m) => {
    _module = m;
    return m;
  });
  return _modulePromise;
}

// ── Per-session state ──

export interface SandboxSession {
  ctx: QuickJSAsyncContext;
  runtime: QuickJSAsyncRuntime;
  /** Reset the CPU-time budget for a new statement. Call before each eval. */
  setStatementStart(): void;
  dispose(): void;
}

export interface SandboxConfig {
  maxHeapMB: number;
  maxStackSizeMb: number;
  maxStatementMs: number;
}

export async function createSandboxSession(
  config: SandboxConfig,
): Promise<SandboxSession> {
  const module = await getQuickJSModule();

  let statementStart = 0;

  const runtime = module.newRuntime({
    maxStackSizeBytes: config.maxStackSizeMb * 1024 * 1024,
    interruptHandler: () => {
      if (statementStart > 0 && Date.now() - statementStart > config.maxStatementMs) {
        return true; // interrupt
      }
      return false;
    },
  });

  runtime.setMemoryLimit(config.maxHeapMB * 1024 * 1024);

  const ctx = runtime.newContext() as QuickJSAsyncContext;

  function setStatementStart(): void {
    statementStart = Date.now();
  }

  function dispose(): void {
    statementStart = 0;
    ctx.dispose();
    runtime.dispose();
  }

  return { ctx, runtime, setStatementStart, dispose };
}
