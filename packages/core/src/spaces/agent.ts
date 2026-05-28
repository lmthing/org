import type { Space, AgentDef } from './load.js';

export interface ResolvedDep {
  space: Space;
  agent: AgentDef;
  target: string; // the string to pass to delegate(), e.g. "@my-org/space/agent"
}

/**
 * Return only the functions listed in agent.config.functions.
 */
export function getAgentFunctions(space: Space, agent: AgentDef): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fnName of agent.config.functions) {
    if (fnName in space.functions) {
      result[fnName] = space.functions[fnName]!;
    }
  }
  return result;
}

/**
 * Resolve agent.dependencies to concrete { space, agent, target } triples.
 *
 * Dependency string formats:
 *   "sommelier/pairing"          – legacy: spaceName (dir component) / agentSlug
 *   "@my-org/space/chef"         – npm scoped package / agentSlug
 *   "@my-org/space/*"            – all agents from that npm space
 *   "space-name/*"               – all agents from a dep matched by dir component or packageName
 */
export function resolveDirectDeps(space: Space, dependencies: string[]): ResolvedDep[] {
  const result: ResolvedDep[] = [];

  for (const dep of dependencies) {
    const idx = dep.lastIndexOf('/');
    if (idx === -1) continue;

    const spaceRef = dep.slice(0, idx);
    const agentSlug = dep.slice(idx + 1);

    const targetSpace = findSpace(space, spaceRef);
    if (!targetSpace) continue;

    if (agentSlug === '*') {
      for (const [slug, agent] of Object.entries(targetSpace.agents)) {
        result.push({ space: targetSpace, agent, target: `${spaceRef}/${slug}` });
      }
    } else {
      const agent = targetSpace.agents[agentSlug];
      if (agent) result.push({ space: targetSpace, agent, target: dep });
    }
  }

  return result;
}

function findSpace(space: Space, spaceRef: string): Space | undefined {
  // 1. Direct match in dependentSpaces by package name
  if (spaceRef in space.dependentSpaces) return space.dependentSpaces[spaceRef];

  // 2. Own space match (package name or last dir component)
  if (
    space.packageName === spaceRef ||
    space.dir === spaceRef ||
    space.dir.endsWith('/' + spaceRef)
  ) {
    return space;
  }

  // 3. Dependent space matched by package name or last dir component (legacy "name/agent" format)
  for (const depSpace of Object.values(space.dependentSpaces)) {
    if (
      depSpace.packageName === spaceRef ||
      depSpace.dir === spaceRef ||
      depSpace.dir.endsWith('/' + spaceRef)
    ) {
      return depSpace;
    }
  }

  return undefined;
}
