/**
 * Load an lmthing space into the shape a dsh agent needs (Stage 3, space parity).
 *
 * An lmthing agent is a persona (`charter.md` + `instruct.md`) plus a set of
 * deterministic `functions:` the model calls inline. On dsh those map to: the
 * agent's system prompt, and one dsh tool per declared function (dsh has no
 * inline-call model — a function becomes a callable tool). This module derives
 * both from a space via `@lmthing/core`'s `loadSpace`, and compiles a function's
 * `export default` source into a callable for the tool's `execute`.
 *
 * Scope: `functions:` → tools, and persona. `fork`/`delegate`/`tasklist` →
 * subagents/workflow and components are the next sub-stage (see HARNESS.md).
 */

import { transform } from 'esbuild';
import { loadSpace } from '@lmthing/core';

export interface DshFunctionSpec {
  name: string;
  /** First doc line / summary shown to the model as the tool description. */
  description: string;
  /** The function's `export default` TypeScript source. */
  source: string;
}

export interface DshAgentSpec {
  persona: string;
  functions: DshFunctionSpec[];
}

/** First meaningful line of a function source, for the tool description. */
function summarize(name: string, source: string): string {
  for (const raw of source.split('\n')) {
    const line = raw.trim().replace(/^\/\/+\s?/, '').replace(/^\/\*+\s?|\s*\*+\/$/g, '').trim();
    if (line && !line.startsWith('import ') && !line.startsWith('export ')) return line.slice(0, 200);
  }
  return `Project function ${name}`;
}

/**
 * Load one agent from a space as a dsh-ready spec: persona (charter then
 * frontmatter-free instruct body) plus a tool spec for each function the agent
 * declares. Unknown/undeclared functions are ignored; a space with none yields
 * an empty `functions`.
 */
export async function loadDshAgent(spaceDir: string, agentSlug: string): Promise<DshAgentSpec> {
  const space = await loadSpace(spaceDir, { requireAgents: false });
  const agent = space.agents[agentSlug];
  if (!agent) return { persona: '', functions: [] };

  const persona = [agent.charterBody, agent.instructBody].map((s) => (s ?? '').trim()).filter((s) => s.length > 0).join('\n\n');

  const declared = readDeclaredFunctions(agent);
  const functions: DshFunctionSpec[] = [];
  for (const name of declared) {
    const source = space.functions[name];
    if (typeof source === 'string') functions.push({ name, description: summarize(name, source), source });
  }
  return { persona, functions };
}

/** The function names an agent declares, tolerant of where the loader keeps them
 *  (`agent.config.functions` today; a top-level `functions` as a fallback). */
function readDeclaredFunctions(agent: unknown): string[] {
  const a = agent as { config?: { functions?: unknown }; functions?: unknown };
  const fromConfig = a.config?.functions;
  if (Array.isArray(fromConfig)) return fromConfig.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(a.functions)) return a.functions.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Compile a function's `export default` source into a callable. Strips TS with
 * esbuild and imports the module via a data URL, returning its default export.
 * The dsh tool calls it with the tool's argument object as the single argument.
 */
export async function compileFunction(source: string): Promise<(args: unknown) => unknown> {
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  const mod = (await import(url)) as { default?: unknown };
  const fn = mod.default;
  if (typeof fn !== 'function') throw new Error('function module has no default-exported function');
  return fn as (args: unknown) => unknown;
}
