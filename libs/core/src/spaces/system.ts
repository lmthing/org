import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSpace } from './load.js';
import type { Space, AgentDef } from './load.js';

/**
 * System spaces are always-loaded baseline capability spaces. Their
 * components/knowledge/agents/tasklists are merged into every user space, and
 * their AGENTS are universally delegatable.
 *
 * FUNCTIONS, however, are universal ONLY when they live in the `system-global`
 * system space (the always-on toolkit: file editing, search, web, memory, todos).
 * Every other system space's functions are SCOPED to its own agent(s) — they reach
 * an agent solely through the per-agent path (getAgentFunctions), so a system space
 * that ships an agent (system-architect, system-research) keeps its specialist
 * functions out of every other space's prompt and VM. See systemFunctionSources below.
 *
 * Capabilities live in spaces, not in ad-hoc core globals (the runtime stays a
 * thin substrate). The host primitives those functions wrap (readFileRaw,
 * writeFileRaw, execShell, fetch) are injected separately by host-tools.ts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The single function-only system space whose functions are injected universally. */
export const GLOBAL_SPACE_NAME = 'system-global';

/** The bundled system spaces shipped with @lmthing/core. */
export const SYSTEM_SPACE_NAMES = [
  'system-global',
  'system-engineer',
  'system-zerostack',
  'system-architect',
  'system-research',
  'system-browser',
  'system-desktop-browser',
  'system-appbuilder',
  'system-vision',
  'system-files',
  'system-store',
  'system-social',
  'user-memory',
  'user-thing',
] as const;

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

/** True for the always-on toolkit space whose functions are injected universally. */
function isGlobalSpace(s: Space): boolean {
  return basename(s.dir) === GLOBAL_SPACE_NAME;
}

/** Names of the UNIVERSAL functions (the `system-global` toolkit only). */
export function systemFunctionNames(systemSpaces: Space[]): Set<string> {
  const names = new Set<string>();
  for (const s of systemSpaces) {
    if (!isGlobalSpace(s)) continue;
    for (const n of Object.keys(s.functions)) names.add(n);
  }
  return names;
}

/** The TS source of every UNIVERSAL function (the `system-global` toolkit; used for the typecheck overlay). */
export function systemFunctionSources(systemSpaces: Space[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systemSpaces) {
    if (!isGlobalSpace(s)) continue;
    for (const [name, src] of Object.entries(s.functions)) out[name] = src;
  }
  return out;
}

/** The bundled JS of every UNIVERSAL function (when the `system-global` space had node_modules). */
export function systemFunctionsBundled(systemSpaces: Space[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systemSpaces) {
    if (!isGlobalSpace(s)) continue;
    for (const [name, src] of Object.entries(s.functionsBundled)) out[name] = src;
  }
  return out;
}

/**
 * Universal functions that are GRANTED-ONLY, not truly universal: they live in the
 * `system-global` toolkit (so `systemFunctionSources`/`systemFunctionNames` still see them —
 * task-level `functions:` allow-lists, which narrow FROM the fork-engine pool, need them there),
 * but they are withheld from the TOP-LEVEL injected view (prompt/DTS/VM) unless the running
 * agent's `functions:` frontmatter names them. `webSearch`/`webFetch` run raw fetch against
 * ambient `fetch` with no persistence step of their own — an agent that can call them directly
 * can research and never store the finding (the research_and_store bypass this closes). See
 * `.issues/research-store-noop-diagnosis.md` (Slice B) and `filterUniversalFunctions` below.
 */
export const GRANTED_ONLY_SYSTEM_FUNCTIONS: ReadonlySet<string> = new Set(['webSearch', 'webFetch']);

/**
 * Narrow a UNIVERSAL function map (system-global toolkit) down to the TOP-LEVEL injected view:
 * every function EXCEPT the granted-only ones in `GRANTED_ONLY_SYSTEM_FUNCTIONS`, unless the
 * running agent's own `functions:` frontmatter names it. Callers keep the UNFILTERED map as the
 * fork-engine pool (task `functions:` allow-lists narrow FROM that unfiltered superset, never
 * from this filtered view) — see session.ts's `poolFunctions`/`poolFunctionsBundled` and
 * delegate.ts's `poolFunctions`.
 */
export function filterUniversalFunctions<T>(map: Record<string, T>, agentFunctionNames: readonly string[] | undefined): Record<string, T> {
  const granted = new Set(agentFunctionNames ?? []);
  const out: Record<string, T> = {};
  for (const [name, value] of Object.entries(map)) {
    if (GRANTED_ONLY_SYSTEM_FUNCTIONS.has(name) && !granted.has(name)) continue;
    out[name] = value;
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
  const form: Record<string, string> = {};
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
