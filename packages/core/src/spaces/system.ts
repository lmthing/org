import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSpace } from './load.js';
import type { Space, AgentDef } from './load.js';

/**
 * System spaces are always-loaded baseline capability spaces (fs, web, memory,
 * todo, agents). Their functions/components/knowledge/agents are merged into
 * every user space so that file editing, search, web, memory, todos and the
 * explore/plan subagents are universally available — without the user space
 * having to declare them.
 *
 * Capabilities live in spaces, not in ad-hoc core globals (the runtime stays a
 * thin substrate). The host primitives those functions wrap (readFileRaw,
 * writeFileRaw, execShell, fetch) are injected separately by host-tools.ts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The bundled system spaces shipped with @repl/core. */
export const SYSTEM_SPACE_NAMES = ['fs', 'web', 'memory', 'todo', 'engineer', 'architect', 'solver', 'deep_research'] as const;

/**
 * Resolve the directory holding the bundled system spaces. At runtime this file
 * lives in dist/ (so system-spaces/ is one level up); under vitest it runs from
 * src/spaces/ (two levels up). Probe both so the path resolves in either layout
 * rather than silently yielding a nonexistent dir.
 * Overridable via LM_SYSTEM_SPACES (csv of dirs) handled by the caller.
 */
export function defaultSystemSpaceDirs(): string[] {
  const candidates = [
    resolve(__dirname, '..', 'system-spaces'), // dist/ layout: dist → core/system-spaces
    resolve(__dirname, '..', '..', 'system-spaces'), // src/ layout: src/spaces → core/system-spaces
  ];
  const base = candidates.find((c) => existsSync(c)) ?? candidates[0]!;
  return SYSTEM_SPACE_NAMES.map((n) => join(base, n));
}

/** Load each system space directory (tolerating function-only spaces with no agents/). */
export async function loadSystemSpaces(dirs: string[]): Promise<Space[]> {
  const spaces: Space[] = [];
  for (const dir of dirs) {
    try {
      spaces.push(await loadSpace(dir, { requireAgents: false }));
    } catch {
      // A missing/invalid system space dir should not break the session.
    }
  }
  return spaces;
}

/** Names of all functions provided by the given system spaces. */
export function systemFunctionNames(systemSpaces: Space[]): Set<string> {
  const names = new Set<string>();
  for (const s of systemSpaces) {
    for (const n of Object.keys(s.functions)) names.add(n);
  }
  return names;
}

/** The TS source of every system function (used for the typecheck overlay). */
export function systemFunctionSources(systemSpaces: Space[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systemSpaces) {
    for (const [name, src] of Object.entries(s.functions)) out[name] = src;
  }
  return out;
}

/** The bundled JS of every system function (when a system space had node_modules). */
export function systemFunctionsBundled(systemSpaces: Space[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systemSpaces) {
    for (const [name, src] of Object.entries(s.functionsBundled)) out[name] = src;
  }
  return out;
}

/**
 * Merge system spaces into a user space. The user space wins on every name
 * collision (so a space can override a system tool). Returns a NEW Space; the
 * inputs are not mutated.
 */
export function mergeSystemInto(userSpace: Space, systemSpaces: Space[]): Space {
  const functions: Record<string, string> = {};
  const functionsBundled: Record<string, string> = {};
  const view: Record<string, string> = {};
  const form: Record<string, { web: string; ink: string }> = {};
  const agents: Record<string, AgentDef> = {};
  const tasklists: Record<string, import('./load.js').TasklistDir> = {};
  const knowledgeDomains = { ...userSpace.knowledge.domains };

  // System first (lower priority)…
  for (const s of systemSpaces) {
    Object.assign(functions, s.functions);
    Object.assign(functionsBundled, s.functionsBundled);
    Object.assign(view, s.components.view);
    Object.assign(form, s.components.form);
    Object.assign(agents, s.agents);
    Object.assign(tasklists, s.tasklists);
    for (const [slug, domain] of Object.entries(s.knowledge.domains)) {
      if (!(slug in knowledgeDomains)) knowledgeDomains[slug] = domain;
    }
  }

  // …user space overlays (higher priority).
  Object.assign(functions, userSpace.functions);
  Object.assign(functionsBundled, userSpace.functionsBundled);
  Object.assign(view, userSpace.components.view);
  Object.assign(form, userSpace.components.form);
  // Agents: a user agent normally wins on a slug collision — BUT an EMPTY placeholder
  // agent (an `agents/<slug>/` dir with no instruct.md → no instructBody and no actions)
  // must NOT shadow a real system agent of the same slug. That silent shadowing is what
  // stripped the system `architect` (its instructions, actions, and defaultAction) when a
  // space happened to contain an empty `agents/architect/` dir.
  for (const [slug, agent] of Object.entries(userSpace.agents)) {
    const isEmptyPlaceholder = !agent.instructBody?.trim() && agent.actions.length === 0;
    if (isEmptyPlaceholder && agents[slug]) continue; // keep the system agent
    agents[slug] = agent;
  }
  // Tasklists: user wins, except an EMPTY user tasklist dir (no .md files) must not
  // shadow a system tasklist of the same slug — same placeholder-shadowing trap as agents
  // (an empty `tasklists/synthesize_and_run/` would otherwise hide the architect's real DAG).
  for (const [slug, tl] of Object.entries(userSpace.tasklists)) {
    if (tl.files.length === 0 && tasklists[slug]) continue; // keep the system tasklist
    tasklists[slug] = tl;
  }

  return {
    ...userSpace,
    functions,
    functionsBundled,
    agents,
    tasklists,
    components: { view, form },
    knowledge: { domains: knowledgeDomains },
  };
}
