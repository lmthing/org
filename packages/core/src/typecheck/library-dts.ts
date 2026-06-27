import { catalogDts } from '../ui/catalog.js';

export const LIBRARY_DTS = `
declare function ask<T = unknown>(descriptor: JSXDescriptor | string): Promise<T>;
declare function display(descriptor: unknown): void;
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): Promise<void>;
declare function loadKnowledge(...path: string[]): Promise<unknown>;
declare function sleep(duration: string): Promise<void>;
declare function tasklist(name: string, seed?: Record<string, unknown>): Promise<unknown>;
declare function fork<T>(opts: ForkOpts<T>): Promise<T>;
declare function delegate(packageName: string, agentName: string, opts?: DelegateOpts): Promise<unknown>;
declare function delegate(packageName: string, agentName: string, action?: string, opts?: DelegateOpts): Promise<unknown>;
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
declare function fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): { ok: boolean; status: number; text(): string; json(): unknown };
declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };
declare function readFileRaw(path: string, opts?: { offset?: number; limit?: number }): { ok: boolean; content: string; lines: number; truncated: boolean; error?: string };
declare function writeFileRaw(path: string, content: string): { ok: boolean; bytes: number; error?: string };
declare function typecheckSource(src: string): { ok: boolean; errors: string[] };
declare function progress(): { episodes: number; toolCalls: number; elapsedMs: number };
` + '\n' + catalogDts();

/**
 * Library DTS WITHOUT `ask`. Fork and delegate VMs run headless/autonomous — there is
 * no interactive user to prompt — so `ask` is not injected there. Removing its
 * declaration makes a stray `await ask(...)` fail typecheck immediately ("Cannot find
 * name 'ask'") and steers the model back to working from its seed/inputs, instead of
 * binding `undefined` (or, in a real PTY, blocking forever on stdin).
 */
export const LIBRARY_DTS_NO_ASK = LIBRARY_DTS.replace(/^declare function ask\b.*\r?\n/m, '');
