import type { StreamOpts, StreamSession } from '../eval/stream-types.js';

export interface RenderHost {
  display(descriptor: unknown): void;
  ask(id: string, descriptor: unknown): Promise<unknown>;
  log(message: string): void;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): void;
  clearTimeout(id: unknown): void;
}

export interface SessionOpts {
  spaceDir: string;
  agentSlug: string;
  modelAlias: string;
  renderHost: RenderHost;
  maxRetries?: number;
  maxConcurrentForks?: number;
  clock?: Clock;
  traceFile?: string;
  /** Override the always-loaded system space directories. Defaults to the
   *  bundled fs/web/memory/todo/agents spaces. Pass [] to disable. */
  systemSpaceDirs?: string[];
  /** When set, collapse history to a summary once it exceeds maxHistoryTurns*2
   *  messages (keeping the last few verbatim). Used by long REPL sessions. */
  maxHistoryTurns?: number;
}

export interface SessionDeps {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
}
