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
}

export interface SessionDeps {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
}
