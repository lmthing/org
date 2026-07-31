import type {
  LocalReadResult,
  LocalRoot,
  LocalSearchResult,
  LocalStatResult,
  LocalTreeResult,
  LocalWriteResult,
} from '../globals/host-fs.js';

/**
 * The host side of a `hostFs` yield: forward it to the attached desktop and shape the answer.
 *
 * Supplied by `libs/cli` (which owns the bridge); `@lmthing/core` never reaches a network or a
 * filesystem itself. Absent ⇒ a clear error rather than a bound `undefined`, matching how
 * `storeResolver`/`teamResolver`/`apiCallResolver` behave in the same router.
 */
export type HostFsResolver = (op: string, args: unknown[]) => Promise<unknown>;

/** Result shapes, keyed by op, so a failure can be reported in the shape the caller expects. */
type AnyResult =
  | LocalRoot[]
  | LocalTreeResult
  | LocalReadResult
  | LocalWriteResult
  | LocalStatResult
  | LocalSearchResult;

/**
 * Never throws.
 *
 * A refusal by the person's grant jail is a NORMAL outcome — it is precisely what the agent is told
 * when it asks for something outside the granted folders — and it must arrive as data the model can
 * read and act on, not as an exception that ends the turn. Same reasoning as
 * `resolveFetchYield`, which swallows a network failure into `{ ok: false }`.
 *
 * `roots` is the one op whose success shape is an array rather than an `{ ok }` envelope, because
 * "which folders may I see" has no partial answer: an empty list IS the answer when nothing is
 * granted, and it reads far better in agent code than `result.roots`.
 */
export async function resolveHostFsYield(
  resolver: HostFsResolver | undefined,
  op: string,
  args: unknown[],
): Promise<AnyResult> {
  if (!resolver) {
    return failure(op, 'localFs is not available here: this pod has no desktop bridge');
  }
  try {
    const value = await resolver(op, args);
    if (op === 'roots') return (Array.isArray(value) ? value : []) as LocalRoot[];
    return value as AnyResult;
  } catch (err) {
    return failure(op, err instanceof Error ? err.message : String(err));
  }
}

function failure(op: string, error: string): AnyResult {
  switch (op) {
    // No desktop means no granted folders to report. An empty list is the honest answer and keeps
    // `for (const root of await localRoots())` from throwing on a machine that is simply offline.
    case 'roots':
      return [];
    case 'tree':
      return { ok: false, entries: [], truncated: false, error };
    case 'read':
      return { ok: false, content: '', lines: 0, truncated: false, error };
    case 'write':
      return { ok: false, bytes: 0, error };
    case 'search':
      return { ok: false, hits: [], truncated: false, error };
    default:
      return { ok: false, error };
  }
}
