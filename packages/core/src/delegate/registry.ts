import type { Space, AgentDef } from '../spaces/load.js';
import { loadSpace } from '../spaces/load.js';
import { parseDelegateRef } from './ref.js';

export class DelegateRegistry {
  constructor(private spaces: Map<string, Space>) {}

  resolve(target: string): { space: Space; agent: AgentDef } {
    const [spaceName, agentSlug] = this.parseTarget(target);

    // Bare slug (no space component, e.g. self-scoped "agent" refs that reach
    // this registry without being pre-resolved against the caller's own space):
    // search every registered space for that agent slug.
    if (spaceName === undefined) {
      for (const space of this.spaces.values()) {
        const agent = space.agents[agentSlug];
        if (agent) return { space, agent };
      }
      throw new Error(`Cannot resolve delegate target "${target}": no registered space has an agent "${agentSlug}"`);
    }

    // Look through spaces by dir or name
    let matchedSpace: Space | undefined;
    for (const space of this.spaces.values()) {
      if (this.matchesSpace(space, spaceName)) {
        matchedSpace = space;
        const agent = space.agents[agentSlug];
        if (agent) {
          return { space, agent };
        }
      }
    }

    // Space matched but the agent slug was wrong → name the real agents in THAT space.
    if (matchedSpace) {
      const slugs = Object.keys(matchedSpace.agents);
      throw new Error(`Cannot resolve delegate target "${target}": space "${spaceName}" has no agent "${agentSlug}" (available agents: ${slugs.join(', ') || 'none'})`);
    }
    throw new Error(`Cannot resolve delegate target "${target}": ${this.availabilityHint(spaceName)}`);
  }

  /** Actionable error tail listing the real space keys + agent slugs the model can use,
   *  so a hallucinated key (e.g. using the agent's TITLE) self-corrects on retry. */
  private availabilityHint(triedSpace: string): string {
    const seen = new Set<string>();
    const entries: string[] = [];
    for (const space of this.spaces.values()) {
      const key = space.packageName ?? space.dir;
      if (seen.has(key)) continue;
      seen.add(key);
      const agents = Object.keys(space.agents);
      entries.push(`"${key}" (agents: ${agents.length ? agents.join(', ') : 'none'})`);
    }
    return `no space matched "${triedSpace}". Use the EXACT space key — available: ${entries.join('; ') || '(none registered)'}`;
  }

  addSpace(key: string, space: Space): void {
    if (!this.spaces.has(key)) this.spaces.set(key, space);
  }

  async preloadDirect(space: Space, agent: AgentDef): Promise<void> {
    for (const dep of agent.canDelegateTo) {
      const [_spaceName, depAgentSlug] = this.parseTarget(dep);
      const depAgent = space.agents[depAgentSlug];
      if (depAgent && !this.spaces.has(dep)) {
        this.spaces.set(dep, space);
      }
    }
  }

  async resolveLazy(target: string): Promise<{ space: Space; agent: AgentDef }> {
    // Try direct resolution first
    let directError: Error;
    try {
      return this.resolve(target);
    } catch (err) {
      directError = err as Error;
    }
    // Lazy load: target may be "path/to/space/agentSlug" on disk.
    const parts = target.split('/');
    if (parts.length < 2) throw directError;

    const agentSlug = parts[parts.length - 1]!;
    const spaceDir = parts.slice(0, -1).join('/');

    let space: Space;
    try {
      space = await loadSpace(spaceDir);
    } catch {
      // Not a real path either — surface the actionable registry error, not a cryptic
      // filesystem error, so the model learns the real keys and retries correctly.
      throw directError;
    }
    this.spaces.set(spaceDir, space);

    const agent = space.agents[agentSlug];
    if (!agent) {
      const slugs = Object.keys(space.agents);
      throw new Error(`Agent "${agentSlug}" not found in space at "${spaceDir}" (available agents: ${slugs.join(', ') || 'none'})`);
    }

    return { space, agent };
  }

  /**
   * Parse a delegate target into [spaceRef, agentSlug]. Accepts the full ref
   * grammar (see delegate/ref.ts): a bare slug ("agent", self scope) yields
   * `spaceRef === undefined` — `resolve()` then searches every registered
   * space for that agent slug instead of requiring an exact space match. A
   * trailing "#action" is stripped — action enforcement happens at the
   * delegate-call layer (globals/delegate.ts + delegate.ts), not here.
   */
  private parseTarget(target: string): [string | undefined, string] {
    const parsed = parseDelegateRef(target);
    if (parsed.scope === 'self') {
      return [undefined, parsed.agent];
    }
    return [parsed.space!, parsed.agent];
  }

  private matchesSpace(space: Space, name: string): boolean {
    // Tolerate an "npm:" prefix in the name being matched against (the dep
    // string form), since package-name/dir matching is prefix-agnostic.
    const bare = name.startsWith('npm:') ? name.slice('npm:'.length) : name;
    if (space.packageName === bare) return true;
    return space.dir === bare || space.dir.endsWith('/' + bare);
  }
}
