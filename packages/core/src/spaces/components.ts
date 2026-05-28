import type { Space, AgentDef } from './load.js';

/**
 * Return only the components listed in agent.config.components.
 */
export function getAgentComponents(
  space: Space,
  agent: AgentDef,
): {
  view: Record<string, string>;
  form: Record<string, { web: string; ink: string }>;
} {
  const view: Record<string, string> = {};
  const form: Record<string, { web: string; ink: string }> = {};

  for (const name of agent.config.components) {
    if (name in space.components.view) {
      view[name] = space.components.view[name]!;
    } else if (name in space.components.form) {
      form[name] = space.components.form[name]!;
    }
  }

  return { view, form };
}
