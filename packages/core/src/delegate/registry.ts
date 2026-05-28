import type { Space, AgentDef } from '../spaces/load.js';
import { loadSpace } from '../spaces/load.js';

export class DelegateRegistry {
  private cycleDetection: Set<string> = new Set();

  constructor(private spaces: Map<string, Space>) {}

  resolve(target: string): { space: Space; agent: AgentDef } {
    const [spaceName, agentSlug] = this.parseTarget(target);

    if (this.cycleDetection.has(target)) {
      throw new Error(`Cycle detected in delegation: "${target}"`);
    }

    // Look through spaces by dir or name
    for (const space of this.spaces.values()) {
      if (this.matchesSpace(space, spaceName)) {
        const agent = space.agents[agentSlug];
        if (agent) {
          return { space, agent };
        }
      }
    }

    throw new Error(`Cannot resolve delegate target "${target}": agent not found`);
  }

  async preloadDirect(space: Space, agent: AgentDef): Promise<void> {
    for (const dep of agent.dependencies) {
      const [_spaceName, depAgentSlug] = this.parseTarget(dep);
      const depAgent = space.agents[depAgentSlug];
      if (depAgent && !this.spaces.has(dep)) {
        this.spaces.set(dep, space);
      }
    }
  }

  async resolveLazy(target: string): Promise<{ space: Space; agent: AgentDef }> {
    // Try direct resolution first
    try {
      return this.resolve(target);
    } catch {
      // Lazy load: target may be "path/to/space/agentSlug"
      const parts = target.split('/');
      if (parts.length < 2) {
        throw new Error(`Cannot resolve "${target}"`);
      }

      const agentSlug = parts[parts.length - 1]!;
      const spaceDir = parts.slice(0, -1).join('/');

      const space = await loadSpace(spaceDir);
      this.spaces.set(spaceDir, space);

      const agent = space.agents[agentSlug];
      if (!agent) {
        throw new Error(`Agent "${agentSlug}" not found in space at "${spaceDir}"`);
      }

      return { space, agent };
    }
  }

  private parseTarget(target: string): [string, string] {
    const idx = target.lastIndexOf('/');
    if (idx === -1) {
      throw new Error(`Invalid delegate target "${target}": expected "space/agent" format`);
    }
    return [target.slice(0, idx), target.slice(idx + 1)];
  }

  private matchesSpace(space: Space, name: string): boolean {
    // Match by directory path or last component of path
    return space.dir === name || space.dir.endsWith('/' + name);
  }
}
