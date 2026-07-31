import type { YieldRequest } from '../eval/yield.js';

/**
 * The agent-facing view of the person's own machine, reached through the LMThing desktop app.
 *
 * ## Two design rules, both load-bearing
 *
 * **1. Root-scoped by construction.** Every call names a `rootId` — an opaque handle for a folder
 * the person granted — plus a path relative to it. There is no absolute-path argument anywhere in
 * this file. A path outside every grant is therefore not *rejected*, it is *inexpressible*, and an
 * agent that never learns `/home/someone/...` cannot leak the directory layout either. The
 * enforcement itself lives on the desktop, in Rust, because the pod is the party executing the
 * untrusted instruction and cannot be asked to police it (see `apps/desktop/src-tauri/src/grants.rs`).
 *
 * **2. Batch-shaped, not POSIX-shaped.** Every one of these is a WAN round trip to the person's
 * laptop. `localTree` returns a whole subtree and `localSearch` returns many hits precisely so an
 * agent does not write the loop that would make 500 of them.
 *
 * Never granted by default: `fs:local:read` and `fs:local:write` are separate capabilities, and
 * neither exists on a team pod.
 */

export interface LocalRoot {
  /** Opaque. Deliberately NOT the absolute path — see rule 1 above. */
  id: string;
  /** What the person called it, e.g. "code" — for showing in a plan, not for path building. */
  label: string;
  mode: 'ro' | 'rw';
}

export interface LocalEntry {
  /** Relative to its root. */
  path: string;
  kind: 'file' | 'dir';
  size: number;
}

export interface LocalTreeResult {
  ok: boolean;
  entries: LocalEntry[];
  /** True when the listing hit the desktop's cap — ask for a narrower `path`. */
  truncated: boolean;
  error?: string;
}

export interface LocalReadResult {
  ok: boolean;
  content: string;
  /** Number of lines returned, matching `ReadFileResult` in `globals/host-tools.ts`. */
  lines: number;
  truncated: boolean;
  error?: string;
}

export interface LocalWriteResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export interface LocalStatResult {
  ok: boolean;
  kind?: 'file' | 'dir';
  size?: number;
  /** Unix milliseconds. */
  mtime?: number;
  error?: string;
}

export interface LocalSearchHit {
  path: string;
  line: number;
  text: string;
}

export interface LocalSearchResult {
  ok: boolean;
  hits: LocalSearchHit[];
  truncated: boolean;
  error?: string;
}

export interface LocalFsGlobals {
  localRoots(): Promise<LocalRoot[]>;
  localTree(rootId: string, path?: string): Promise<LocalTreeResult>;
  localStat(rootId: string, path: string): Promise<LocalStatResult>;
  localRead(
    rootId: string,
    path: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<LocalReadResult>;
  localSearch(rootId: string, query: string, opts?: { path?: string }): Promise<LocalSearchResult>;
  localWrite(rootId: string, path: string, content: string): Promise<LocalWriteResult>;
}

/**
 * Build the local-filesystem globals over the yield protocol.
 *
 * Yields rather than host calls, because these cross a network. `globals/host-tools.ts`'s
 * `readFileRawAt`/`writeFileRawAt` are marshalled into QuickJS as SYNCHRONOUS host calls, so a
 * remote filesystem can never be a drop-in there — the async seam is the yield router, whose own
 * comment anticipates exactly this ("a future `execShell`/`tool` yield kind would follow the same
 * shape").
 */
export function createHostFsGlobals(pushYield: (req: YieldRequest) => void): LocalFsGlobals {
  const call = <T>(op: string, args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pushYield({
        kind: 'hostFs',
        args: [op, ...args],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });

  return {
    localRoots: () => call<LocalRoot[]>('roots', []),
    localTree: (rootId, path) => call<LocalTreeResult>('tree', [rootId, path]),
    localStat: (rootId, path) => call<LocalStatResult>('stat', [rootId, path]),
    localRead: (rootId, path, opts) => call<LocalReadResult>('read', [rootId, path, opts]),
    localSearch: (rootId, query, opts) => call<LocalSearchResult>('search', [rootId, query, opts]),
    localWrite: (rootId, path, content) => call<LocalWriteResult>('write', [rootId, path, content]),
  };
}
