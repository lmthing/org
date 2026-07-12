/**
 * Shared delegate-ref grammar parser. Parses the six forms documented in
 * org/format/space/agents/delegation.md for `AgentDef.canDelegateTo` entries (and delegate-call targets
 * built from them):
 *
 *   agent                 -> { scope: 'self',    agent }
 *   agent#action          -> { scope: 'self',    agent, action }
 *   space/agent           -> { scope: 'project', space, agent }
 *   space/agent#action    -> { scope: 'project', space, agent, action }
 *   npm:pkg/agent         -> { scope: 'npm',      space: 'pkg', agent }
 *   npm:pkg/agent#action  -> { scope: 'npm',      space: 'pkg', agent, action }
 *
 * `space`/`pkg` may themselves contain `/` (e.g. scoped npm packages like
 * "@my-org/space"), so splitting happens on the LAST `/` before the agent slug.
 */
export interface ParsedDelegateRef {
  scope: 'self' | 'project' | 'npm';
  /** Present for 'project' and 'npm' scopes; the space/package reference. */
  space?: string;
  agent: string;
  action?: string;
}

export function parseDelegateRef(ref: string): ParsedDelegateRef {
  let rest = ref;
  let isNpm = false;

  if (rest.startsWith('npm:')) {
    isNpm = true;
    rest = rest.slice('npm:'.length);
  }

  let action: string | undefined;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    action = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }

  const slashIdx = rest.lastIndexOf('/');
  if (slashIdx === -1) {
    if (isNpm) {
      throw new Error(`Invalid delegate ref "${ref}": "npm:" prefix requires a "pkg/agent" path`);
    }
    return { scope: 'self', agent: rest, action };
  }

  const space = rest.slice(0, slashIdx);
  const agent = rest.slice(slashIdx + 1);
  return { scope: isNpm ? 'npm' : 'project', space, agent, action };
}
