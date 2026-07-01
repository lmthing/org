import { parseDelegateRef, type ParsedDelegateRef } from '../delegate/ref.js';
import type { Space } from '../spaces/load.js';

/**
 * Unified delegate-target matching.
 *
 * Absorbs the two independently-written matchers that used to live in
 * `fork/fork.ts` (`resolveTaskDelegate`, gating a task's `canDelegateTo`) and
 * `delegate/delegate.ts` (the inline `directDeps.find` fuzzy match resolving a
 * child delegate's `allowedActions`). Both parsed ref strings by hand with
 * slightly different suffix/prefix tolerance; the unified matcher reuses
 * `parseDelegateRef` (the shared ref grammar) and accepts the UNION of what the
 * two old matchers accepted:
 *   - space part vs packageName: exact, or directory-suffix in either direction
 *     ("a/b/c" ~ "c") — the old fork tolerance
 *   - full "space/agent" target vs packageName with the same tolerance — the
 *     old delegate tolerance (a caller may pass the whole ref as packageName)
 *   - bare self-scope entries ("agent") compare the agent slug itself as the
 *     package part — the old fork behavior for slash-less entries
 *   - "npm:pkg/agent" entries match delegate("pkg", "agent") — parseDelegateRef
 *     strips the prefix (the old hand-rolled parsers did not)
 */

/** Symmetric fuzzy name match: exact, or dir-suffix tolerance in either direction. */
function fuzzyNameMatch(a: string, b: string): boolean {
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a);
}

/**
 * Does a `canDelegateTo`-style ref (or a ResolvedDep `target` string) match a
 * `delegate(packageName, agentName)` call? Any `#action` suffix is ignored here —
 * action gating happens in `resolveTaskDelegate` / `ResolvedDep.allowedActions`.
 * An unparseable ref never matches.
 */
export function refMatchesDelegateCall(ref: string, packageName: string, agentName: string): boolean {
  let parsed: ParsedDelegateRef;
  try {
    parsed = parseDelegateRef(ref);
  } catch {
    return false;
  }
  if (parsed.agent !== agentName) return false;
  // Package part: bare self-scope entries historically compared the agent slug itself.
  const pkg = parsed.space ?? parsed.agent;
  if (fuzzyNameMatch(pkg, packageName)) return true;
  // Full-target tolerance (old delegate.ts matcher): the caller may have passed the
  // whole "space/agent" ref string as packageName.
  const fullTarget = parsed.space ? `${parsed.space}/${parsed.agent}` : parsed.agent;
  return fuzzyNameMatch(fullTarget, packageName);
}

/**
 * Decide whether a `delegate(packageName, agentName, action)` call is permitted by a task's
 * `canDelegateTo` allowlist. Entries are `"space/agent"` (any action) or `"space/agent#action"`.
 * Returns the allowed actions for the matched target (`undefined` = any action), or `null` when the
 * target is not in the allowlist at all.
 */
export function resolveTaskDelegate(
  canDelegateTo: string[],
  packageName: string,
  agentName: string,
): { allowedActions: string[] | undefined } | null {
  const matchedActions: Array<string | undefined> = [];
  for (const entry of canDelegateTo) {
    if (!refMatchesDelegateCall(entry, packageName, agentName)) continue;
    let action: string | undefined;
    try {
      action = parseDelegateRef(entry).action || undefined;
    } catch {
      continue; // unreachable after a successful match, but keep the parse guarded
    }
    matchedActions.push(action);
  }
  if (matchedActions.length === 0) return null;
  // A match with no `#action` allows every action; otherwise only the listed actions.
  if (matchedActions.some((a) => !a)) return { allowedActions: undefined };
  return { allowedActions: matchedActions.filter((a): a is string => Boolean(a)) };
}

// ---------------------------------------------------------------------------
// Unified `canDelegateTo` policy (Phase 5)
// ---------------------------------------------------------------------------

/** The `canDelegateTo` wildcard granting delegation to any space registered at
 *  runtime via `registerSpace()` (i.e. present in the session's shared
 *  `dynamicSpaces` map at call time). May appear alongside concrete entries. */
export const REGISTERED_WILDCARD = 'registered:*';

export type DelegatePolicyLevel = 'agent' | 'task';

/**
 * The evaluated meaning of a `canDelegateTo` declaration — ONE shared shape for
 * BOTH declaration levels (agent instruct.md frontmatter and task frontmatter)
 * and every enforcement point (capability/DTS resolution + the yield-time gate).
 */
export interface DelegatePolicy {
  /** 'none' → `delegate` is not injected and absent from the ambient DTS;
   *  'unrestricted' → injected, any target; 'allowlist' → injected, gated. */
  mode: 'none' | 'unrestricted' | 'allowlist';
  /** Concrete allowlist entries (ref strings — `space/agent[#action]` etc.),
   *  with the wildcard entries (`*`, `registered:*`) filtered out. */
  entries: string[];
  /** The allowlist includes `registered:*`. */
  allowRegistered: boolean;
}

/**
 * Evaluate a raw `canDelegateTo` declaration into a `DelegatePolicy`.
 *
 * | Value           | agent level                         | task level      |
 * |-----------------|-------------------------------------|-----------------|
 * | omitted         | unrestricted (back-compat)          | none            |
 * | `[]`            | none                                | none            |
 * | `["*"]`         | unrestricted                        | unrestricted    |
 * | explicit list   | allowlist (hard, yield-time gate)   | allowlist       |
 * | `registered:*`  | any `registerSpace()`d space — may accompany other entries |
 *
 * Historically the agent level was a silent no-op (`[]` still delegated
 * unrestricted); the loader now warns on `[]` so migrating spaces self-diagnose.
 */
export function evaluateDelegatePolicy(
  entries: string[] | undefined,
  level: DelegatePolicyLevel,
): DelegatePolicy {
  if (entries === undefined) {
    // Level default: an agent that says nothing keeps its historical unrestricted
    // delegate (user spaces on disk must not break); a task that says nothing has
    // never had delegate — unchanged.
    return { mode: level === 'agent' ? 'unrestricted' : 'none', entries: [], allowRegistered: false };
  }
  if (entries.length === 0) return { mode: 'none', entries: [], allowRegistered: false };
  if (entries.includes('*')) return { mode: 'unrestricted', entries: [], allowRegistered: false };
  return {
    mode: 'allowlist',
    entries: entries.filter((e) => e !== REGISTERED_WILDCARD),
    allowRegistered: entries.includes(REGISTERED_WILDCARD),
  };
}

/** Result of the yield-time gate: whether the call may proceed, and — for an
 *  allowlist match with `#action` suffixes — which action ids are permitted
 *  (`undefined` = all actions, composing with the existing allowedActions
 *  narrowing enforced inside `runDelegate`). */
export interface DelegateAllowance {
  allowed: boolean;
  allowedActions?: string[];
}

/** The structural subset of `Space` the registered-space check needs (so tests
 *  can pass lightweight fakes). */
type RegisteredSpaceLike = Pick<Space, 'dir' | 'packageName'>;

/** Does `packageName` name a space present in the shared dynamicSpaces map —
 *  by map key (usually the dir `registerSpace` was called with), by the space's
 *  own dir, or by its npm package name — with the same dir-suffix tolerance the
 *  ref matcher uses? (Agent existence is NOT checked here: a wrong agent slug on
 *  a registered space should fail downstream with the precise "agent not found"
 *  error, not a misleading policy denial.) */
export function matchesRegisteredSpace(
  packageName: string,
  dynamicSpaces: Map<string, RegisteredSpaceLike> | undefined,
): boolean {
  if (!dynamicSpaces) return false;
  for (const [key, space] of dynamicSpaces) {
    if (fuzzyNameMatch(key, packageName)) return true;
    if (space.dir && fuzzyNameMatch(space.dir, packageName)) return true;
    if (space.packageName && fuzzyNameMatch(space.packageName, packageName)) return true;
  }
  return false;
}

/**
 * THE yield-time gate. Decides whether a `delegate(packageName, agentName, …)`
 * call is permitted by an evaluated policy. All delegate paths (session VM,
 * delegate VM, fork-leaf VM) consult this one function.
 */
export function isDelegateAllowed(
  policy: DelegatePolicy,
  packageName: string,
  agentName: string,
  dynamicSpaces?: Map<string, RegisteredSpaceLike>,
): DelegateAllowance {
  if (policy.mode === 'none') return { allowed: false };
  if (policy.mode === 'unrestricted') return { allowed: true };
  const match = resolveTaskDelegate(policy.entries, packageName, agentName);
  if (match) return { allowed: true, allowedActions: match.allowedActions };
  if (policy.allowRegistered && matchesRegisteredSpace(packageName, dynamicSpaces)) {
    return { allowed: true }; // registered wildcard: any action
  }
  return { allowed: false };
}

/** Actionable, retryable denial message naming the allowed targets so the model
 *  can self-correct on the next turn. */
export function formatDelegateDenial(
  policy: DelegatePolicy,
  packageName: string,
  agentName: string,
  level: DelegatePolicyLevel,
): string {
  const scope = level === 'agent' ? 'this agent' : 'this task';
  if (policy.mode === 'none') {
    return `delegate("${packageName}", "${agentName}") is not permitted — ${scope} declares no delegation targets (canDelegateTo: []).`;
  }
  const allowed = [
    ...policy.entries,
    ...(policy.allowRegistered ? ['any space registered at runtime via registerSpace()'] : []),
  ];
  return `delegate("${packageName}", "${agentName}") is not permitted from ${scope} — allowed targets: ${allowed.join(', ') || '(none)'}`;
}
