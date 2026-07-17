#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { applyCwd } from './cwd.js';

// Load .env from the directory where the script is invoked. Unconditionally
// overwrites process.env for any key present in the file — this file is the
// one written by PUT /api/env (server/routes/env.ts) and persisted on the pod
// volume, so it must supersede the pod's k8s-injected env vars (e.g. the
// litellmEnvDefaults set by cloud/gateway), matching applyEnvContent's
// semantics in server/serve.ts, which re-applies the same file later.
function loadEnv() {
  // An explicit `--env-file <path>` wins (scanned straight from argv because this runs before
  // formal arg parsing); otherwise the .env in the invocation cwd is used. This lets the server
  // run with a cwd chosen for its runtime root (<cwd>/.lmthing) while still loading keys from a
  // .env that lives elsewhere.
  const flagIdx = process.argv.indexOf('--env-file');
  const envPath = flagIdx !== -1 && process.argv[flagIdx + 1]
    ? resolve(process.argv[flagIdx + 1])
    : join(process.cwd(), '.env');
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key) process.env[key] = val;
    }
  } catch { /* no .env in cwd */ }
}
// `--cwd <dir>` switches the working directory first, so both the .env below and the
// runtime root (<cwd>/.lmthing) resolve against it. No-op when the flag is absent.
applyCwd(process.argv.slice(2));
loadEnv();

import { Session, createMockStreamFn, mockScript, defaultSystemSpaceDirs } from '@lmthing/core';
import type { StreamOpts, StreamSession, MockHandler } from '@lmthing/core';
import { parseArgs, type CliArgs } from './args.js';
import { materializeRuntime, runtimeNeedsInit, syncSystemSpaces } from './runtime-init.js';
import { bootProjectApp } from '../app/boot.js';
import type { ProjectDb } from '../app/store.js';
import { generateProjectContracts } from '../app/build/contracts.js';
import { createProjectAuthoringGlobals } from '../app/authoring/index.js';
import { resolveAlias } from '../providers/aliases.js';
import { resolveModel } from '../providers/resolve.js';
import { createStream } from '../stream/stream.js';
import { InkRenderHost } from '../render/ink-renderer.js';
import { WebRenderHost } from '../rpc/server.js';
import { startWebServer } from '../web/serve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getAutocompleteWords(args: CliArgs, lmthingRoot: string): Promise<string[]> {
  const { loadSpace, loadSystemSpaces } = await import('@lmthing/core');
  const words = new Set<string>();

  const addSpace = (space: any) => {
    const spaceId = space.dir ? basename(space.dir) : 'user';
    words.add(`@${spaceId}`);
    for (const [agentSlug, agent] of Object.entries(space.agents || {})) {
      words.add(`@${spaceId}.${agentSlug}`);
      if ((agent as any).actions) {
        for (const action of (agent as any).actions) {
          words.add(`@${spaceId}.${agentSlug}.${action.id}`);
        }
      }
    }
  };

  try {
    const { systemSpaceDirs } = resolveAgentAndSpaces(args);
    const sysSpaces = await loadSystemSpaces(systemSpaceDirs ?? defaultSystemSpaceDirs());
    for (const s of sysSpaces) addSpace(s);
  } catch {}

  if (args.space) {
    try {
      const userSpace = await loadSpace(args.space);
      addSpace(userSpace);
    } catch {}
  }

  try {
    const projectSpacesDir = join(lmthingRoot, 'user', 'spaces');
    const dirs = await readdir(projectSpacesDir);
    for (const d of dirs) {
      try {
        const space = await loadSpace(join(projectSpacesDir, d));
        addSpace(space);
      } catch {}
    }
  } catch {}

  return Array.from(words);
}

function ReplPrompt({ question, completions, onDone }: { question: string, completions: string[], onDone: (val: string) => void }) {
  const [value, setValue] = useState('');
  
  useInput((input, key) => {
    if (key.tab) {
      const parts = value.split(/\s+/);
      const currentWord = parts[parts.length - 1] ?? '';
      if (currentWord) {
        const hits = completions.filter(c => c.startsWith(currentWord));
        if (hits.length === 1) {
          parts[parts.length - 1] = hits[0]!;
          setValue(parts.join(' ') + ' ');
        } else if (hits.length > 1) {
          const idx = hits.indexOf(currentWord);
          const next = idx === -1 ? hits[0]! : hits[(idx + 1) % hits.length]!;
          parts[parts.length - 1] = next;
          setValue(parts.join(' '));
        }
      }
    }
  }, { isActive: true });

  return React.createElement(Box, null,
    React.createElement(Text, { color: "cyan" }, question),
    React.createElement(TextInput, { value, onChange: setValue, onSubmit: onDone })
  );
}

function readLine(question: string, completions: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    const { unmount } = render(
      React.createElement(ReplPrompt, {
        question,
        completions,
        onDone: (val: string) => {
          unmount();
          process.stdout.write(`\\x1b[2K\\x1b[G\\x1b[36m${question}\\x1b[39m${val}\\n`);
          resolve(val.trim());
        }
      })
    );
  });
}

/**
 * Per-role fork model overrides from env. Returns undefined when none are set,
 * so the session default model is used for every role.
 *   LM_MODEL_ROLE_EXPLORE, LM_MODEL_ROLE_PLAN, LM_MODEL_ROLE_GENERAL
 * Values are model specs or aliases (resolved later by the provider layer).
 */
function readRoleModels(): { explore?: string; plan?: string; general?: string } | undefined {
  const config: { explore?: string; plan?: string; general?: string } = {};
  const explore = process.env['LM_MODEL_ROLE_EXPLORE'];
  const plan = process.env['LM_MODEL_ROLE_PLAN'];
  const general = process.env['LM_MODEL_ROLE_GENERAL'];
  if (explore) config.explore = explore;
  if (plan) config.plan = plan;
  if (general) config.general = general;
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Assemble host budget caps from CLI flags, falling back to env
 * (LM_BUDGET_EPISODES / _TOOL_CALLS / _FORK_DEPTH / _WALLCLOCK_MS). Returns
 * undefined when nothing is set, so the session runs unbounded by default.
 */
function readBudget(args: CliArgs): {
  maxEpisodes?: number;
  maxToolCalls?: number;
  maxForkDepth?: number;
  maxWallClockMs?: number;
} | undefined {
  const envNum = (key: string): number | undefined => {
    const raw = process.env[key];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const budget: { maxEpisodes?: number; maxToolCalls?: number; maxForkDepth?: number; maxWallClockMs?: number } = {};
  const maxEpisodes = args.maxEpisodes ?? envNum('LM_BUDGET_EPISODES');
  const maxToolCalls = args.maxToolCalls ?? envNum('LM_BUDGET_TOOL_CALLS');
  const maxForkDepth = args.maxForkDepth ?? envNum('LM_BUDGET_FORK_DEPTH');
  const maxWallClockMs = args.maxWallClockMs ?? envNum('LM_BUDGET_WALLCLOCK_MS');
  if (maxEpisodes !== undefined) budget.maxEpisodes = maxEpisodes;
  if (maxToolCalls !== undefined) budget.maxToolCalls = maxToolCalls;
  if (maxForkDepth !== undefined) budget.maxForkDepth = maxForkDepth;
  if (maxWallClockMs !== undefined) budget.maxWallClockMs = maxWallClockMs;
  return Object.keys(budget).length > 0 ? budget : undefined;
}

/**
 * Build a scripted `streamFn` from a mock module path (no credentials needed).
 * The module's default export is a `MockHandler`, or a `string[]` (wrapped in
 * `mockScript`). ESM `.mjs` so it loads with no transpile step. Resolved relative
 * to the cwd where the CLI runs.
 */
async function loadMockStreamFn(mockPath: string): Promise<(opts: StreamOpts) => Promise<StreamSession>> {
  const url = pathToFileURL(resolve(process.cwd(), mockPath)).href;
  const mod = await import(url);
  const def = mod.default ?? mod.handler;
  if (def === undefined) {
    throw new Error(`mock module "${mockPath}" has no default export (expected a MockHandler or string[])`);
  }
  if (Array.isArray(def)) return mockScript(def as string[]);
  if (typeof def !== 'function') {
    throw new Error(`mock module "${mockPath}" default export must be a function (MockHandler) or string[]`);
  }
  return createMockStreamFn(def as MockHandler);
}

/**
 * Resolve the persistent runtime root. The single source of truth for project
 * spaces, synced spaces, and session snapshots. `LMTHING_ROOT` overrides the
 * default `<cwd>/.lmthing` so the compute pod can persist onto its data volume
 * (e.g. `LMTHING_ROOT=/data/.lmthing`). `<cwd>` is the working directory after
 * any `--cwd` flag has been applied (see `applyCwd`, invoked at bin.ts startup).
 */
function resolveLmthingRoot(): string {
  const override = process.env['LMTHING_ROOT'];
  if (override && override.trim().length > 0) return resolve(override.trim());
  return join(process.cwd(), '.lmthing');
}

/**
 * Initialize the runtime if needed, then reconcile materialized system spaces with the
 * shipped source: pristine copies auto-adopt updates; locally-modified ones are held
 * back (adopt with `--adopt-system-spaces`). Keeps a dev's source edits — and image
 * upgrades — flowing into `<root>/system/` without a stale-copy surprise.
 */
function ensureRuntime(root: string, args: CliArgs): void {
  if (runtimeNeedsInit(root)) {
    materializeRuntime(root);
    process.stdout.write(`lmthing runtime initialized/repaired at ${root}\n`);
    return;
  }
  const sync = syncSystemSpaces(root, { adopt: args.adoptSystemSpaces });
  if (sync.updated.length > 0) {
    process.stdout.write(`lmthing: adopted updated system space(s): ${sync.updated.join(', ')}\n`);
  }
  if (sync.heldBack.length > 0) {
    process.stderr.write(
      `lmthing: system space update(s) available but held back (local edits preserved): ` +
      `${sync.heldBack.join(', ')} — re-run with --adopt-system-spaces to overwrite (a backup is kept)\n`,
    );
  }
}

/**
 * Resolve the system spaces selection (explicit flag, env, disabled, or default)
 * and the agent slug — shared by the normal run path and --dump-system-prompt.
 */
function resolveAgentAndSpaces(args: CliArgs): { agentSlug: string; systemSpaceDirs: string[] | undefined } {
  const agentSlug = args.agent ?? process.env['LM_AGENT'] ?? 'default';
  const envSystemSpaces = process.env['LM_SYSTEM_SPACES']?.split(',').map((s) => s.trim()).filter(Boolean);
  const systemSpaceDirs: string[] | undefined = args.noSystemSpaces
    ? []
    : args.systemSpaces ?? envSystemSpaces;
  return { agentSlug, systemSpaceDirs };
}

/**
 * Build the resolved system prompt for the chosen agent and write it to a file.
 * Keyless: uses a stub streamFn + no-op render host, never calls the model.
 */
async function dumpSystemPromptToFile(args: CliArgs): Promise<void> {
  const { agentSlug, systemSpaceDirs } = resolveAgentAndSpaces(args);
  const noopHost = { display() {}, ask: async () => undefined, log() {} };
  const stubStreamFn = async () => { throw new Error('stub streamFn — dump mode does not run the model'); };
  const session = new Session(
    { spaceDir: args.space, agentSlug, modelAlias: 'dump', renderHost: noopHost, systemSpaceDirs },
    { streamFn: stubStreamFn as unknown as (opts: StreamOpts) => Promise<StreamSession> },
  );
  const { agentSlug: resolved, systemBlock, ambientDts } = await session.buildSystemPrompt();
  session.dispose();
  const out =
    `# System prompt — space: ${args.space}  agent: ${resolved}\n` +
    `# This is the exact \`system\` message sent to the model.\n\n` +
    systemBlock +
    `\n\n${'='.repeat(80)}\n` +
    `# Ambient DTS (typecheck context — NOT sent as prose; the model's code is validated against it)\n` +
    `${'='.repeat(80)}\n\n` +
    ambientDts +
    '\n';
  writeFileSync(resolve(process.cwd(), args.dumpSystemPrompt!), out, 'utf8');
  process.stdout.write(`System prompt for agent "${resolved}" written to ${args.dumpSystemPrompt}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // --dump-system-prompt: write the resolved system prompt and exit (keyless).
  if (args.dumpSystemPrompt) {
    await dumpSystemPromptToFile(args);
    return;
  }

  // `lmthing init`: materialize the runtime into <cwd>/.lmthing (keyless).
  if (args.init) {
    const root = join(process.cwd(), '.lmthing');
    materializeRuntime(root);
    process.stdout.write(
      `lmthing runtime initialized at ${root}\n` +
      `  system spaces → ${join(root, 'system')}\n` +
      `  default project → ${join(root, 'user')}\n`,
    );
    return;
  }

  // Mock mode: skip resolveModel/createStream entirely so no API key is required.
  const mockPath = args.mock ?? process.env['LM_MOCK'];
  let modelSpec: string;
  let streamFn: (opts: StreamOpts) => Promise<StreamSession>;

  if (mockPath) {
    modelSpec = `mock:${mockPath}`;
    streamFn = await loadMockStreamFn(mockPath);
  } else {
    modelSpec = resolveAlias(args.model ?? process.env['LM_MODEL'] ?? 'M');

    // Resolve models LAZILY — never at startup — so the server boots even when no
    // valid model is configured yet (the custom-env endpoint PUT /api/env can then
    // supply credentials). Each call re-reads the current env / alias, so env
    // changes take effect for newly-constructed models without a process restart.
    const modelCache = new Map<string, Awaited<ReturnType<typeof resolveModel>>>();
    const getModel = async (spec?: string): Promise<Awaited<ReturnType<typeof resolveModel>>> => {
      const resolvedSpec = resolveAlias(spec ?? args.model ?? process.env['LM_MODEL'] ?? 'M');
      const cached = modelCache.get(resolvedSpec);
      if (cached) return cached;
      const resolved = await resolveModel(resolvedSpec);
      modelCache.set(resolvedSpec, resolved);
      return resolved;
    };

    streamFn = async (opts: StreamOpts) => {
      const { model: modelOverride, ...rest } = opts;
      return createStream({ model: await getModel(modelOverride), ...rest });
    };
  }

  // Serve mode: one HTTP+WS server hosting many independent agent sessions.
  // Builds streamFn exactly like the web branch above (live or --mock), then a
  // SessionManager + reaper. Sessions are created via POST /api/sessions.
  if (args.serve) {
    const { SessionManager } = await import('../server/session-manager.js');
    const { startSessionServer } = await import('../server/serve.js');
    const port = args.servePort ?? 8080;
    // Persistent runtime root. Honors LMTHING_ROOT so the pod can point this at
    // its data volume (e.g. /data/.lmthing); defaults to <cwd>/.lmthing locally.
    const lmthingRoot = resolveLmthingRoot();
    // Initialize (or repair) the runtime before serving: materialize the system
    // spaces if the `thing` agent isn't present. Without this the pod serves
    // from an empty system/ dir and every session fails with
    // `Agent "thing" not found`. (The bare-`lmthing` path below does the same.)
    //
    // Only the correctness-critical MATERIALIZE runs pre-`listen`; the adopt-
    // updates SYNC (a full hashDir walk of the system-spaces tree) is deferred
    // until AFTER the server is listening (below), so on a scaled-to-zero cold
    // wake it never delays time-to-serve / the startup probe. A pod's PVC keeps
    // the materialized tree across scale-to-zero, so the common wake path takes
    // the fast `!needsInit` branch and pays zero pre-listen I/O here.
    const runtimeInitialized = runtimeNeedsInit(lmthingRoot);
    if (runtimeInitialized) {
      materializeRuntime(lmthingRoot);
      process.stdout.write(`lmthing runtime initialized/repaired at ${lmthingRoot}\n`);
    }
    const manager = new SessionManager({
      streamFn,
      defaultSpaceDir: args.space,
      lmthingRoot,
      defaultModelAlias: modelSpec,
      ...(args.maxSessions !== undefined ? { maxSessions: args.maxSessions } : {}),
      ...(args.snapshotsDir !== undefined ? { snapshotsDir: args.snapshotsDir } : {}),
    });
    manager.startReaper();
    process.on('SIGINT', () => { manager.stopReaper(); process.exit(0); });
    // __dirname is dist/cli/ at runtime; app.tsx is at dist/web/app.tsx
    const appTsxPath = join(__dirname, '..', 'web', 'app.tsx');
    // startSessionServer resolves once the HTTP server is LISTENING (its own
    // post-listen boot work runs without blocking routability). Adopt any
    // updated system spaces now — off the boot critical path, so this hashDir
    // walk never gates time-to-serve. Skipped when we just materialized above
    // (a fresh tree has nothing to adopt), matching the old ensureRuntime flow.
    await startSessionServer({ port, manager, appTsxPath, defaultSpaceDir: args.space, lmthingRoot });
    if (!runtimeInitialized) {
      try {
        const sync = syncSystemSpaces(lmthingRoot, { adopt: args.adoptSystemSpaces });
        if (sync.updated.length > 0) {
          process.stdout.write(`lmthing: adopted updated system space(s): ${sync.updated.join(', ')}\n`);
        }
        if (sync.heldBack.length > 0) {
          process.stderr.write(
            `lmthing: system space update(s) available but held back (local edits preserved): ` +
            `${sync.heldBack.join(', ')} — re-run with --adopt-system-spaces to overwrite\n`,
          );
        }
      } catch (err) {
        process.stderr.write(`lmthing: system-space sync failed (non-fatal): ${err}\n`);
      }
    }
    return; // keep process alive via the listening server
  }

  // Bare `lmthing` invocation (no --space, no message, no single-run / repl / web
  // flags): launch the multi-session server just like `lmthing serve`.
  const isBareDefault =
    !args.space &&
    !args.message &&
    !args.repl &&
    !args.webPort &&
    !args.request;
  if (isBareDefault) {
    const { SessionManager } = await import('../server/session-manager.js');
    const { startSessionServer } = await import('../server/serve.js');
    const port = args.servePort ?? 8080;
    const lmthingRoot = resolveLmthingRoot();
    // Auto-initialize if this is the first run, OR repair a half-initialized
    // runtime. runtimeNeedsInit() checks for the materialized `thing` system
    // space rather than just the `system/` dir: a persistent volume may carry an
    // empty `system/` from an earlier broken materialization (e.g. unresolved
    // bundle assets), and that must be re-populated or every session fails to
    // find the agent.
    ensureRuntime(lmthingRoot, args);
    const manager = new SessionManager({
      streamFn,
      lmthingRoot,
      defaultModelAlias: modelSpec,
      ...(args.maxSessions !== undefined ? { maxSessions: args.maxSessions } : {}),
      ...(args.snapshotsDir !== undefined ? { snapshotsDir: args.snapshotsDir } : {}),
    });
    manager.startReaper();
    process.on('SIGINT', () => { manager.stopReaper(); process.exit(0); });
    const appTsxPath = join(__dirname, '..', 'web', 'app.tsx');
    await startSessionServer({ port, manager, appTsxPath, lmthingRoot });
    return; // keep process alive via the listening server
  }

  // Per-role fork models from env: LM_MODEL_ROLE_EXPLORE / _PLAN / _GENERAL.
  const roleModels = readRoleModels();

  // Host budget caps from --max-* flags or LM_BUDGET_* env (undefined = unbounded).
  const budget = readBudget(args);

  // Agent slug + system spaces (explicit list, env override, disabled, or default).
  const { agentSlug, systemSpaceDirs } = resolveAgentAndSpaces(args);

  if (args.webPort) {
    // Web mode: load space, start combined HTTP+WS server, open browser
    const { loadSpace } = await import('@lmthing/core');
    const space = await loadSpace(args.space);

    const renderHost = new WebRenderHost();
    const session = new Session(
      {
        spaceDir: args.space,
        agentSlug,
        modelAlias: modelSpec,
        renderHost,
        traceFile: args.traceFile,
        systemSpaceDirs,
        noDefaultAction: args.noDefaultAction,
        roleModels,
        budget,
      },
      { streamFn },
    );

    // __dirname is dist/cli/ at runtime; app.tsx is at dist/web/app.tsx
    const appTsxPath = join(__dirname, '..', 'web', 'app.tsx');
    await startWebServer({ port: args.webPort, session, renderHost, space, agentSlug, appTsxPath, traceFile: args.traceFile });
    // Keep process alive
  } else if (args.repl) {
    // Interactive REPL mode: persistent session, multi-turn conversation
    const renderHost = new InkRenderHost(args.claude);
    const session = new Session(
      {
        spaceDir: args.space,
        agentSlug,
        modelAlias: modelSpec,
        renderHost,
        traceFile: args.traceFile,
        systemSpaceDirs,
        noDefaultAction: args.noDefaultAction,
        roleModels,
        budget,
        maxHistoryTurns: 20,
      },
      { streamFn },
    );

    process.on('SIGINT', () => { session.dispose(); process.exit(0); });

    process.stdout.write(`REPL — space: ${args.space}  agent: ${agentSlug}\nType a message, or "exit" to quit.\n\n`);

    const completions = await getAutocompleteWords(args, resolveLmthingRoot());

    // First message — may have been passed as a positional arg or prompted
    let firstMessage = args.message;
    if (!firstMessage) {
      firstMessage = await readLine('> ', completions);
      if (!firstMessage.trim() || firstMessage.trim() === 'exit') {
        session.dispose();
        return;
      }
    }

    await session.start(firstMessage.trim());

    // Subsequent messages continue the same session
    while (true) {
      const input = await readLine('\n> ', completions);
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') break;
      await session.continue(trimmed);
    }

    session.dispose();
  } else if (args.request) {
    // Headless single-shot mode: --request "..."
    // Materializes the runtime (same as bare/serve), then runs one turn of the
    // THING agent and exits. --space defaults to cwd so project-local agents
    // are picked up automatically.
    const lmthingRoot = resolveLmthingRoot();
    ensureRuntime(lmthingRoot, args);
    const spaceDir = args.space ?? process.cwd();
    const renderHost = new InkRenderHost(/* plain= */ true);
    // The default 'user' project's spaces/ tree — the single source of truth for
    // synthesized spaces (same convention as serve mode and the session-manager).
    // Passing it as an ABSOLUTE path is REQUIRED: it propagates into delegate/fork
    // VMs as LMTHING_PROJECT_SPACES_DIR so the architect's builder functions
    // (writeAgentFile/writeTaskFile/…) resolve a new space's path absolutely. Without
    // it they fall back to a relative path resolved against the architect's OWN space
    // dir, writing files where registerSpace can't find them (the build "succeeds" but
    // registration fails with "must have an agents/ directory").
    const projectSpacesDir = join(lmthingRoot, 'user', 'spaces');
    // Agents built by earlier sessions live under projectSpacesDir — preload them
    // so they are delegatable (registered:*) AND advertised in the system prompt.
    // Without this, a follow-up session couldn't see its own built agents.
    let preloadSpaceDirs: string[] = [];
    try {
      const entries = await readdir(projectSpacesDir, { withFileTypes: true });
      preloadSpaceDirs = entries.filter((e) => e.isDirectory()).map((e) => join(projectSpacesDir, e.name));
    } catch { /* no project spaces yet */ }
    // Project-app layer: the default 'user' project is the ambient app. Boot its db
    // (restore→open→reconcile, fail-loud on non-additive schema drift) so an agent
    // holding db:* capabilities reaches the project's SQLite store. Returns null for a
    // spaces-only project (no database/), leaving THING and other cap-less agents
    // exactly as before (no projectRoot ⇒ no app globals).
    const projectId = 'user';
    const projectRoot = join(lmthingRoot, projectId);
    let projectDb: ProjectDb | null = null;
    try {
      projectDb = await bootProjectApp(projectRoot);
    } catch (err) {
      console.error(`[app] failed to boot project "${projectId}": ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    // Phase 4: generate the typed-contract bundle (typed apiCall overloads for the agent's
    // DTS). Only when the project has an api/ dir; failure is non-fatal (agent falls back to
    // the generic apiCall signature).
    let appDts: string | undefined;
    if (existsSync(join(projectRoot, 'api'))) {
      try {
        appDts = (await generateProjectContracts(projectRoot)).apiCallDts;
      } catch (err) {
        console.error(`[app] contract generation failed for "${projectId}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const session = new Session(
      {
        spaceDir,
        agentSlug: args.agent ?? 'thing',
        modelAlias: modelSpec,
        renderHost,
        traceFile: args.traceFile,
        systemSpaceDirs,
        noDefaultAction: args.noDefaultAction,
        roleModels,
        budget,
        projectSpacesDir,
        preloadSpaceDirs,
        projectId,
        projectRoot,
        // LIVE-PROJECT authoring writers, bound to THIS project's own dir. Harmless
        // to always include: core only injects the `writeProject*` family for an agent
        // holding the matching authoring capability (`hooks:write` — which THING and
        // ordinary agents lack), so a headless "build me a feed" capstone run has them
        // available to an appbuilder/automator delegate without affecting any other agent.
        // (The old store-catalog authoring engine has been removed.)
        appGlobals: (() => {
          const projectAuthoring = createProjectAuthoringGlobals({ projectRoot });
          return {
            ...(projectDb ? { db: projectDb.db } : undefined),
            writeProjectHook: projectAuthoring.writeProjectHook,
            writeProjectEvent: projectAuthoring.writeProjectEvent,
            writeProjectFunction: projectAuthoring.writeProjectFunction,
            writeProjectTable: projectAuthoring.writeProjectTable,
            writeProjectPage: projectAuthoring.writeProjectPage,
            writeProjectComponent: projectAuthoring.writeProjectComponent,
            writeProjectApi: projectAuthoring.writeProjectApi,
            listProjectDir: projectAuthoring.listProjectDir,
            readProjectFile: projectAuthoring.readProjectFile,
          };
        })(),
        appDts,
      },
      { streamFn },
    );

    await session.start(args.request);
    session.dispose();
    projectDb?.close();
  } else {
    // Terminal mode: single message, run to completion
    const renderHost = new InkRenderHost(args.claude);
    const session = new Session(
      {
        spaceDir: args.space,
        agentSlug,
        modelAlias: modelSpec,
        renderHost,
        traceFile: args.traceFile,
        systemSpaceDirs,
        noDefaultAction: args.noDefaultAction,
        roleModels,
        budget,
      },
      { streamFn },
    );

    await session.start(args.message);
    session.dispose();
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
