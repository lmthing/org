import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { loadFunctionsFromDir } from './load.js';

/** The two function maps for one scope: original TS source (always) + bundled
 *  ESM (only when the scope shipped an installed `node_modules/`). Mirrors the
 *  `{ functions, functionsBundled }` shape a Space carries. */
export interface ProjectFunctions {
  functions: Record<string, string>;
  functionsBundled: Record<string, string>;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Load a PROJECT's functions — the THIRD function scope
 * (`<projectRoot>/functions/*.ts`), alongside the universal `system-global`
 * toolkit and per-space `functions/`. A direct mirror of a Space's function
 * loading (`loadFunctionsFromDir`, `spaces/load.ts`): the original TS source is
 * always returned; bundled ESM is produced (esbuild) only when the project ships
 * an installed `node_modules/`, so a project function can `import` a dependency
 * at runtime just like a space function can.
 *
 * Project-scoped by construction — the caller (libs/cli's SessionManager) only
 * loads these for project-rooted sessions, so a legacy/non-project session never
 * sees them (nor do they appear in that session's DTS overlay).
 */
export async function loadProjectFunctions(projectRoot: string): Promise<ProjectFunctions> {
  const nodeModulesPath = join(projectRoot, 'node_modules');
  const nodeModulesDir = (await dirExists(nodeModulesPath)) ? nodeModulesPath : undefined;
  // `loadFunctionsFromDir(dir, …)` reads `<dir>/functions` — pass the project root
  // as `dir` so it resolves `<projectRoot>/functions`, esbuild `absWorkingDir` +
  // `resolveDir` identical to how a space loads its own functions.
  return loadFunctionsFromDir(projectRoot, nodeModulesDir);
}

/**
 * Scope a project's functions against the names ALREADY provided by higher-
 * priority scopes (the `system-global` toolkit + the agent's selected SPACE
 * functions). A project function whose name collides with one of those is
 * DROPPED — **space/system wins** — and reported via `onShadow`.
 *
 * Dropping (rather than overriding) is load-bearing on two fronts:
 *   1. The higher-priority declaration stays the single source of truth for both
 *      the injected implementation AND the system-block description.
 *   2. The DTS overlay never emits a duplicate `declare function <name>` (a hard
 *      TypeScript redeclaration error), because the merged function set the
 *      overlay is built from stays name-disjoint.
 *
 * Returns the disjoint subset safe to merge into the injected function set and
 * the overlay.
 */
export function scopeProjectFunctions(
  project: ProjectFunctions,
  reservedNames: Iterable<string>,
  onShadow?: (name: string) => void,
): ProjectFunctions {
  const reserved = new Set(reservedNames);
  const functions: Record<string, string> = {};
  const functionsBundled: Record<string, string> = {};
  for (const [name, src] of Object.entries(project.functions)) {
    if (reserved.has(name)) {
      onShadow?.(name);
      continue;
    }
    functions[name] = src;
    if (name in project.functionsBundled) functionsBundled[name] = project.functionsBundled[name]!;
  }
  return { functions, functionsBundled };
}
