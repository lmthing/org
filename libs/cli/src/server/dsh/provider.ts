/**
 * The `dsh` harness provider: turns the manager's {@link BuildSessionArgs} into a
 * {@link DshSession}. Register it on a pod (via `SessionManagerOpts.harnessProviders`
 * or `manager.registerHarness`) when `LMTHING_DSH_HOME` points at a built dsh
 * checkout; a project pinned to `harness: 'dsh'` then runs on the embedded dsh
 * runtime instead of the QuickJS engine.
 *
 * MVP scope: persona is loaded best-effort from the agent's `charter.md` +
 * `instruct.md`. Full space loading (functions → tools, fork/delegate/tasklist →
 * subagents/workflow, app-serving) is the space-format and app-serving plugins
 * (Stages 3–4 in HARNESS.md); this provider is the runtime + persona seam they
 * build on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessProvider, BuildSessionArgs } from '../session-manager.js';
import { DshSession } from './session.js';
import { resolveDshHome, dshRuntimeAvailable, type DshLlmSetup } from './modules.js';
import { createLiteLlmSetup } from './litellm.js';

export interface DshProviderConfig {
  /** Wires the LLM provider onto each session's dsh Context (e.g.
   *  {@link createLiteLlmSetup}). Required — see DshSession. */
  llm: DshLlmSetup;
  /** Run agents in dsh Code Mode (default true — keeps "the model writes
   *  TypeScript"). */
  codeMode?: boolean;
  /** Built dsh checkout dir; defaults to `LMTHING_DSH_HOME`. */
  dshHome?: string;
}

/** Best-effort agent persona: `charter.md` then `instruct.md` (frontmatter
 *  stripped), concatenated. Returns '' when neither is present — a project may
 *  point at a space that has not been authored for dsh yet. */
export function loadAgentPersona(spaceDir: string, agentSlug: string): string {
  const base = join(spaceDir, 'agents', agentSlug);
  const parts: string[] = [];
  try {
    parts.push(readFileSync(join(base, 'charter.md'), 'utf8').trim());
  } catch {
    /* no charter */
  }
  try {
    parts.push(stripFrontmatter(readFileSync(join(base, 'instruct.md'), 'utf8')).trim());
  } catch {
    /* no instruct */
  }
  return parts.filter((p) => p.length > 0).join('\n\n');
}

/** Drop a leading `---\n…\n---` YAML frontmatter block if present. */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const after = text.indexOf('\n', end + 1);
  return after === -1 ? '' : text.slice(after + 1);
}

/** The LiteLLM model name the dsh harness runs on: `LMTHING_DSH_MODEL`, else the
 *  pod's default model spec with any `provider:` prefix stripped (LiteLLM keys on
 *  the bare model name), else a sane default. */
export function resolveDshModel(defaultModelSpec: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['LMTHING_DSH_MODEL'];
  if (explicit && explicit.trim().length > 0) return explicit;
  if (defaultModelSpec) {
    const bare = defaultModelSpec.includes(':') ? defaultModelSpec.slice(defaultModelSpec.indexOf(':') + 1) : defaultModelSpec;
    if (bare.length > 0) return bare;
  }
  return 'DeepSeek-V4-Flash';
}

/**
 * Register the `dsh` harness on a manager when this pod can run it — a built dsh
 * checkout is present (`LMTHING_DSH_HOME`) — wiring its LLM through the LiteLLM
 * gateway. No-op (returns false) otherwise, so a project pinned to `dsh` on a pod
 * without dsh fails loud via `HarnessUnavailableError` rather than mis-running.
 */
export function maybeRegisterDshHarness(
  manager: { registerHarness(p: HarnessProvider): void },
  opts: { defaultModelSpec?: string } = {},
): boolean {
  if (!dshRuntimeAvailable()) return false;
  const model = resolveDshModel(opts.defaultModelSpec);
  manager.registerHarness(createDshHarnessProvider({ llm: createLiteLlmSetup({ model }) }));
  return true;
}

/** Construct the `dsh` harness provider. */
export function createDshHarnessProvider(config: DshProviderConfig): HarnessProvider {
  const dshHome = config.dshHome ?? resolveDshHome();
  return {
    id: 'dsh',
    label: 'DeepSeek Harness',
    buildSession: (args: BuildSessionArgs) =>
      new DshSession({
        sessionId: args.sessionId ?? `dsh-${args.agentSlug}-${args.projectId ?? 'np'}`,
        persona: loadAgentPersona(args.spaceDir, args.agentSlug),
        ...(args.model !== undefined ? { model: args.model } : {}),
        codeMode: config.codeMode ?? true,
        cwd: args.projectRoot ?? args.spaceDir,
        ...(dshHome !== undefined ? { dshHome } : {}),
        llm: config.llm,
      }),
  };
}
