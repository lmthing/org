/**
 * Soft loader for the DeepSeek Harness runtime.
 *
 * dsh ships as separate `@deepseek-ai/dsh-*` packages that are NOT a dependency
 * of `@lmthing/cli` — the harness is optional and dsh is a fast-moving developer
 * preview. So the dsh provider imports them dynamically at runtime from a built
 * dsh checkout, resolved from `LMTHING_DSH_HOME`. This keeps `@lmthing/cli`
 * building, typechecking, and running with no dsh present; the `dsh` harness
 * simply reports unavailable until a pod points `LMTHING_DSH_HOME` at a built
 * checkout.
 *
 * The dsh surface is typed structurally here (the pieces we call), so the rest of
 * the integration is written against named types rather than `any`, while the
 * actual objects cross the dynamic-import boundary untyped and are asserted once.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** The minimal dsh runtime surface the harness drives (see the embed guide). */
export interface DshModules {
  Context: new () => DshContext;
  LlmRuntime: unknown;
  SessionStore: unknown;
  SystemPrompt: unknown;
  ToolRuntime: unknown;
  AgentRegistry: unknown;
  AgentLoop: unknown;
  CodeRuntimeWorker: unknown;
  createUserMessage: (opts: { content: Array<{ type: string; text?: string }>; source: { kind: string } }) => unknown;
  /** Brand a string as a dsh SessionId (identity function at runtime). */
  SessionId: (id: string) => unknown;
  /** Base class for a custom LLM adapter; extend + implement `stream`. */
  LlmAdapter: abstract new () => unknown;
  /** The `@deepseek-ai/dsh-llm-deepseek` plugin namespace (a function plugin) —
   *  an OpenAI-compatible `/chat/completions` provider, mountable against any
   *  such endpoint (the LiteLLM gateway) via its `baseURL`/`apiKeyEnv` config. */
  LlmDeepseek: unknown;
}

/**
 * How a session's LLM provider is wired onto the freshly-booted dsh Context.
 * `configure` mounts a provider (a mock adapter, or a provider plugin like
 * llm-deepseek pointed at LiteLLM) and returns the provider route + model the
 * agent should run on. Kept as a seam so the runtime is provider-agnostic and
 * tests can inject a keyless mock.
 */
export interface DshLlmSetup {
  configure(ctx: DshContext, dsh: DshModules): Promise<{ provider: string; model: string }>;
}

/** The bits of a dsh `Context` we use. */
export interface DshContext {
  plugin(plugin: unknown, config?: unknown): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): () => void;
  llm: { registerAdapter(providers: string[], adapter: unknown): { (): void } | unknown };
  agents: { create(options: DshCreateAgentOptions): Promise<DshAgentHandle> };
  fiber: { dispose(): Promise<void> };
}

export interface DshCreateAgentOptions {
  sessionId: unknown;
  meta?: { cwd?: string };
  agentOptions?: { provider?: string; model?: string; maxTokens?: number };
  setup?: (agentCtx: DshAgentCtx) => void | Promise<void>;
}

export interface DshAgentCtx {
  systemPrompt: { section(section: { name: string; order: number; text: string; complete?: boolean }): () => void };
  tools: { register(def: unknown): () => void; presentAs?(mode: string): void; restrict?(r: { allow?: string[]; deny?: string[] }): void };
  on(event: string, handler: (...args: unknown[]) => void): () => void;
}

export interface DshAgentHandle {
  agent: {
    followup(message: unknown): void;
    whenIdle(): Promise<void>;
    session?: { id?: unknown };
  };
  dispose(): Promise<void>;
}

/** Where the built dsh checkout lives, or `undefined` when the harness is not
 *  configured on this pod. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = env['LMTHING_DSH_HOME'];
  return home && home.trim().length > 0 ? home : undefined;
}

/** The `packages/<group>/<pkg>/lib/index.js` entry for one dsh package. Importing
 *  a dsh package by its own absolute lib path lets Node resolve that package's
 *  internal bare imports (siblings + the `@deepseek-ai/cordis` peer) from the
 *  package's own directory — which pnpm has linked — so no top-level symlink of
 *  the workspace package from the checkout root is required. */
function libEntry(dshHome: string, group: string, pkg: string): string {
  return join(dshHome, 'packages', group, pkg, 'lib', 'index.js');
}

const DSH_LIBS = {
  llm: ['llm', 'llm'],
  llmDeepseek: ['llm', 'llm-deepseek'],
  session: ['core', 'session'],
  systemPrompt: ['core', 'system-prompt'],
  tools: ['core', 'tools'],
  agent: ['core', 'agent'],
  agentLoop: ['core', 'agent-loop'],
  codeWorker: ['code-runtime', 'code-runtime-worker-thread'],
} as const;

/** True when a dsh checkout appears built (its core lib entries exist), so
 *  {@link loadDshModules} would succeed. Used to decide whether to register the
 *  `dsh` provider at all. */
export function dshRuntimeAvailable(dshHome: string | undefined = resolveDshHome()): boolean {
  if (!dshHome) return false;
  return existsSync(libEntry(dshHome, 'core', 'agent-loop')) && existsSync(libEntry(dshHome, 'llm', 'llm'));
}

/**
 * Dynamically import the minimal dsh runtime from a built checkout. Throws a
 * clear error when `LMTHING_DSH_HOME` is unset or the checkout is not built.
 */
export async function loadDshModules(dshHome: string | undefined = resolveDshHome()): Promise<DshModules> {
  if (!dshHome) {
    throw new Error('dsh harness: LMTHING_DSH_HOME is not set (point it at a built deepseek-harness checkout)');
  }
  if (!dshRuntimeAvailable(dshHome)) {
    throw new Error(`dsh harness: no built dsh runtime under ${dshHome} (run \`pnpm build:lib:host\` there)`);
  }
  const load = (key: keyof typeof DSH_LIBS): Promise<Record<string, unknown>> => {
    const [group, pkg] = DSH_LIBS[key];
    return import(pathToFileURL(libEntry(dshHome, group, pkg)).href) as Promise<Record<string, unknown>>;
  };
  // The @deepseek-ai/cordis peer is linked inside each dsh package's node_modules;
  // resolve it relative to one of them (agent-loop) rather than the checkout root.
  const loadCordis = (): Promise<Record<string, unknown>> => {
    const req = createRequire(libEntry(dshHome, 'core', 'agent-loop'));
    return import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href) as Promise<Record<string, unknown>>;
  };

  const [cordis, llm, llmDeepseek, session, systemPrompt, tools, agent, agentLoop, codeWorker] = await Promise.all([
    loadCordis(),
    load('llm'),
    load('llmDeepseek'),
    load('session'),
    load('systemPrompt'),
    load('tools'),
    load('agent'),
    load('agentLoop'),
    load('codeWorker'),
  ]);

  return {
    Context: cordis['Context'] as DshModules['Context'],
    LlmRuntime: llm['default'],
    SessionStore: session['default'],
    SystemPrompt: systemPrompt['default'],
    ToolRuntime: tools['default'],
    AgentRegistry: agent['default'],
    AgentLoop: agentLoop['default'],
    CodeRuntimeWorker: codeWorker['default'],
    createUserMessage: llm['createUserMessage'] as DshModules['createUserMessage'],
    SessionId: (session['SessionId'] ?? ((id: string) => id)) as DshModules['SessionId'],
    LlmAdapter: llm['LlmAdapter'] as DshModules['LlmAdapter'],
    // A function plugin is its module namespace (name/inject/Config/apply), not a default export.
    LlmDeepseek: llmDeepseek,
  };
}
