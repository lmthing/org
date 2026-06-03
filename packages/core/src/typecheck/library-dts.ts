export const LIBRARY_DTS = `
declare function ask<T = unknown>(descriptor: JSXDescriptor | string): Promise<T>;
declare function display(descriptor: JSXDescriptor | string): void;
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): Promise<void>;
declare function loadKnowledge(...path: string[]): Promise<unknown>;
declare function sleep(duration: string): Promise<void>;
declare function tasklist(name: string, seed?: Record<string, unknown>): Promise<unknown>;
declare function fork<T>(opts: ForkOpts<T>): Promise<T>;
declare function delegate(packageName: string, agentName: string, action: string, opts?: DelegateOpts): Promise<unknown>;

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
}

declare interface DelegateOpts {
  query?: string;
  context?: unknown;
}

// Host-injected globals available in space functions and agent code
declare function execShell(cmd: string): { ok: boolean; stdout: string; stderr: string };
declare function fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): { ok: boolean; status: number; text(): string; json(): unknown };
declare const process: { env: Record<string, string | undefined> };
`;
