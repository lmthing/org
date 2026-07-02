import { catalogDts } from '../ui/catalog.js';

/**
 * Ambient declarations for the value-yielding ORCHESTRATION globals, split out
 * per-global so `buildAmbientDts` (exec/bootstrap.ts) can compose each VM
 * context's DTS additively:
 *   - session: all of them
 *   - delegate: everything except `ask`
 *   - fork leaf: none of them; `delegate` is added back only when the task opts
 *     in via `canDelegateTo`
 * A global that is not declared fails typecheck on a stray call — a clean,
 * retryable error — instead of passing typecheck and throwing at runtime.
 */
export const ASK_DTS = `declare function ask<T = unknown>(descriptor: JSXDescriptor | string): Promise<T>;`;
// tasklist() resolves to a TaskEnvelope: { ok: boolean; degraded: boolean; data: <goal output>;
// reason?: string; degradedTasks?: string[] }. Branch on r.ok / r.degraded; the payload is r.data.
// Declared `any` by convention so r.data.field reads without casts.
export const TASKLIST_DTS = `/** Runs a named tasklist. Resolves to { ok, degraded, data, reason?, degradedTasks? } — branch on r.ok/r.degraded; the goal output is r.data. */
declare function tasklist(name: string, seed?: Record<string, unknown>): Promise<any>;`;
export const FORK_DTS = `declare function fork<T>(opts: ForkOpts<T>): Promise<T>;`;
export const DELEGATE_DTS = `declare function delegate(packageName: string, agentName: string, opts?: DelegateOpts): Promise<any>;
declare function delegate(packageName: string, agentName: string, action?: string, opts?: DelegateOpts): Promise<any>;`;

/**
 * Declarations present in EVERY VM context (session, fork leaf, delegate): the
 * non-orchestration globals, supporting interfaces, host-injected primitives and
 * the design-system catalog. NOTE: `registerSpace` stays declared even where the
 * global is not injected (read-only fork roles, delegates) — matching the
 * pre-unification DTS, where only ask/tasklist/fork/delegate were stripped.
 */
export const COMMON_DTS = `
declare function display(descriptor: unknown): void;
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): Promise<void>;
declare function loadKnowledge(...path: string[]): Promise<any>;
declare function sleep(duration: string): Promise<void>;
declare function registerSpace(dir: string): Promise<{ ok: boolean; spaceKey: string; agentSlug: string; error?: string }>;

declare interface JSXDescriptor {
  type: string | ((...args: unknown[]) => unknown);
  props: Record<string, unknown>;
  children?: JSXDescriptor[];
}

// Classic JSX factory — declared globally so <Foo /> syntax typechecks without imports
declare namespace React {
  function createElement(type: any, props?: Record<string, unknown> | null, ...children: any[]): JSXDescriptor;
  const Fragment: string;
}
// JSX namespace for classic transform intrinsics
declare namespace JSX {
  interface Element extends JSXDescriptor {}
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
  // Models reflexively write key={i} inside .map() loops (React muscle memory).
  // Accept it on every component instead of failing the statement — the renderer
  // simply ignores it.
  interface IntrinsicAttributes {
    key?: string | number;
  }
}

declare interface InspectQuery {
  path?: string;
  slice?: [number, number];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}

declare interface ForkOpts<T> {
  instruction: string;
  output: Record<string, string>;
  seed?: Record<string, unknown>;
  timeout?: number;
  /** 'explore'/'plan' run read-only (cannot write/edit/mutate); 'general' (default) has the full toolkit. */
  role?: 'explore' | 'plan' | 'general';
}

declare interface DelegateOpts {
  query?: string;
  context?: unknown;
}

// Host-injected globals available in space functions and agent code
declare function execShell(cmd: string, opts?: { timeout?: number }): { ok: boolean; stdout: string; stderr: string; exitCode: number };
declare function fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text(): string; json(): unknown }>;
declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };
declare function readFileRaw(path: string, opts?: { offset?: number; limit?: number }): { ok: boolean; content: string; lines: number; truncated: boolean; error?: string };
declare function writeFileRaw(path: string, content: string): { ok: boolean; bytes: number; error?: string };
declare function typecheckSource(src: string): { ok: boolean; errors: string[] };
declare function spacePath(...parts: string[]): string;
declare function resolveSpaceDir(space: string): string;
declare function progress(): { episodes: number; toolCalls: number; elapsedMs: number };
` + '\n' + catalogDts();

/** Full library DTS for the top-level session VM (all globals, incl. `ask`). */
export const LIBRARY_DTS = [ASK_DTS, TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, COMMON_DTS].join('\n');

/**
 * Library DTS WITHOUT `ask`. Fork and delegate VMs run headless/autonomous — there is
 * no interactive user to prompt — so `ask` is not injected there. Removing its
 * declaration makes a stray `await ask(...)` fail typecheck immediately ("Cannot find
 * name 'ask'") and steers the model back to working from its seed/inputs, instead of
 * binding `undefined` (or, in a real PTY, blocking forever on stdin).
 */
export const LIBRARY_DTS_NO_ASK = [TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, COMMON_DTS].join('\n');
