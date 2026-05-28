import type { Space, AgentDef } from './load.js';

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
