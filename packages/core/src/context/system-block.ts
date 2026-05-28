import type { Space, AgentDef } from '../spaces/load.js';
import type { ResolvedDep } from '../spaces/agent.js';
import { getAgentFunctions } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';

export interface SystemBlockOpts {
  space: Space;
  agent: AgentDef;
  directDeps: ResolvedDep[];
}

const RUNTIME_PREAMBLE = `
CRITICAL INSTRUCTION: You are a TypeScript code execution agent. You MUST respond with TypeScript code ONLY. Do NOT write any prose, explanations, markdown, or natural language. Your entire response will be fed directly into a TypeScript evaluator. Even a single word of prose will cause an error.

Respond with valid TypeScript statements only. Use top-level \`await\` for async operations (e.g. \`const x = await ask(...)\`). Do not wrap code in functions or markdown code blocks. Just write the statements directly.

WRONG (do not do this):
  "I'll help you make pasta by first asking your preferences."

CORRECT (do this):
  const approach = await ask(<ConfirmDish dish="pasta" />);
`.trim();

const GLOBALS_SUMMARY = `
# Available Globals

- \`ask(descriptor)\` — render an interactive form and await user input (yields)
- \`display(descriptor)\` — render content to the surface (void, no yield)
- \`inspect(...values)\` — inspect variables with optional queries (yields)
- \`loadKnowledge(...path)\` — load a knowledge file by path segments (yields)
- \`sleep(duration)\` — pause execution for a duration like "1s", "500ms" (yields)
- \`tasklist(name)\` — run a named tasklist and return its goal output (yields)
- \`fork(opts)\` — spawn a child task and await its result (yields)
- \`delegate(packageName, agentName, action, opts?)\` — delegate to another agent's action (yields)

Value-yielding globals (ask, inspect, loadKnowledge, sleep, tasklist, fork, delegate) end the current turn.
display() is void and does not end the turn.
`.trim();

/**
 * Build the system prompt for an agent.
 */
export function buildSystemBlock(opts: SystemBlockOpts): string {
  const { space, agent, directDeps } = opts;

  const sections: string[] = [];

  // 0. Runtime preamble — always first
  sections.push(RUNTIME_PREAMBLE);

  // 1. Globals summary
  sections.push(GLOBALS_SUMMARY);

  // 2. Agent instructions
  if (agent.instructBody) {
    sections.push(`# Agent Instructions\n\n${agent.instructBody}`);
  }

  // 3. Agent actions
  if (agent.actions.length > 0) {
    const actionLines = agent.actions.map(
      (a) => `- \`${a.id}\` — **${a.label}**: ${a.description} (tasklist: ${a.tasklist})`,
    );
    sections.push(`# Actions\n\n${actionLines.join('\n')}`);
  }

  // 4. Scoped functions
  const agentFunctions = getAgentFunctions(space, agent);
  if (Object.keys(agentFunctions).length > 0) {
    const fnParts = Object.entries(agentFunctions).map(
      ([name, src]) => `## ${name}\n\`\`\`ts\n${src}\n\`\`\``,
    );
    sections.push(`# Available Functions\n\n${fnParts.join('\n\n')}`);
  }

  // 4b. Knowledge tree
  const knowledgeDomains = Object.keys(space.knowledge.domains);
  if (knowledgeDomains.length > 0 && agent.config.knowledge.length > 0) {
    const relevantDomains = agent.config.knowledge.filter((k) => knowledgeDomains.includes(k));
    if (relevantDomains.length > 0) {
      const domainLines = relevantDomains.map((slug) => {
        const domain = space.knowledge.domains[slug]!;
        const fields = Object.entries(domain.fields).map(([fSlug, f]) => {
          const options = Object.keys(f.options).join(', ');
          return `  - \`${fSlug}\` (${f.type}): ${options ? `options: ${options}` : 'no options'}`;
        });
        return `- **${slug}**:\n${fields.join('\n')}`;
      });
      sections.push(`# Knowledge\n\nAccess with \`loadKnowledge(domain, field, option)\`:\n\n${domainLines.join('\n')}`);
    }
  }

  // 4c. Components
  const agentComponents = getAgentComponents(space, agent);
  const viewNames = Object.keys(agentComponents.view);
  const formNames = Object.keys(agentComponents.form);
  if (viewNames.length > 0 || formNames.length > 0) {
    const compLines: string[] = [];
    if (viewNames.length > 0) compLines.push(`View: ${viewNames.join(', ')}`);
    if (formNames.length > 0) compLines.push(`Form: ${formNames.join(', ')}`);
    sections.push(`# Components\n\n${compLines.join('\n')}`);
  }

  // 5. Direct dependency agents
  if (directDeps.length > 0) {
    const depParts = directDeps.map(({ agent: depAgent, target }) => {
      const slash = target.lastIndexOf('/');
      const pkgName = target.slice(0, slash);
      const agentName = target.slice(slash + 1);
      const actionLines = depAgent.actions
        .map((a) => `  - \`${a.id}\`: ${a.description}`)
        .join('\n');
      const callExample = depAgent.actions[0]
        ? `delegate("${pkgName}", "${agentName}", "${depAgent.actions[0].id}", { query, context })`
        : `delegate("${pkgName}", "${agentName}", actionId)`;
      return `## ${target} — ${depAgent.title}\n${actionLines}\n\n  Example: \`${callExample}\``;
    });
    sections.push(`# Delegatable Agents\n\n${depParts.join('\n\n')}`);
  }

  return sections.join('\n\n');
}
