#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Load .env from the directory where the script is invoked
function loadEnv() {
  try {
    const lines = readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* no .env in cwd */ }
}
loadEnv();

import { Session, createMockStreamFn, mockScript } from '@lmthing/core';
import type { StreamOpts, StreamSession, MockHandler } from '@lmthing/core';
import { parseArgs, type CliArgs } from './args.js';
import { resolveAlias } from '../providers/aliases.js';
import { resolveModel } from '../providers/resolve.js';
import { createStream } from '../stream/stream.js';
import { InkRenderHost } from '../render/ink-renderer.js';
import { WebRenderHost } from '../rpc/server.js';
import { startWebServer } from '../web/serve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read one line using the same 'readable' + read() paused-mode pattern Ink uses.
// Avoids 'data' listeners (which force flowing mode) and readline (which leaves
// permanent emitKeypressEvents listeners) — both break Ink's raw-mode stdin.read().
function readLine(question: string): Promise<string> {
  process.stdout.write(question);
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let buf = '';
    const onReadable = () => {
      let chunk: string | null;
      while ((chunk = process.stdin.read() as string | null) !== null) {
        buf += chunk;
        const rIdx = buf.indexOf('\r');
        const nIdx = buf.indexOf('\n');
        const idx = rIdx === -1 ? nIdx : nIdx === -1 ? rIdx : Math.min(rIdx, nIdx);
        if (idx !== -1) {
          process.stdin.off('readable', onReadable);
          // Do NOT pause() — pause() sets kPaused=true which prevents Ink's
          // later read(0) from calling _read(), so the TTY never starts reading.
          resolve(buf.slice(0, idx).trim());
          return;
        }
      }
    };
    process.stdin.on('readable', onReadable);
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
  const { writeFileSync } = await import('node:fs');
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

  // Mock mode: skip resolveModel/createStream entirely so no API key is required.
  const mockPath = args.mock ?? process.env['LM_MOCK'];
  let modelSpec: string;
  let streamFn: (opts: StreamOpts) => Promise<StreamSession>;

  if (mockPath) {
    modelSpec = `mock:${mockPath}`;
    streamFn = await loadMockStreamFn(mockPath);
  } else {
    modelSpec = resolveAlias(args.model ?? process.env['LM_MODEL'] ?? 'M');
    const model = await resolveModel(modelSpec);

    // Resolve per-request model overrides (e.g. a fork's role model) lazily, caching
    // by spec so each distinct model is constructed once. Falls back to the default.
    const modelCache = new Map<string, Awaited<ReturnType<typeof resolveModel>>>([[modelSpec, model]]);
    const getModel = async (spec?: string): Promise<typeof model> => {
      if (!spec) return model;
      const resolvedSpec = resolveAlias(spec);
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

    // First message — may have been passed as a positional arg or prompted
    let firstMessage = args.message;
    if (!firstMessage) {
      firstMessage = await readLine('> ');
      if (!firstMessage.trim() || firstMessage.trim() === 'exit') {
        session.dispose();
        return;
      }
    }

    await session.start(firstMessage.trim());

    // Subsequent messages continue the same session
    while (true) {
      const input = await readLine('\n> ');
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') break;
      await session.continue(trimmed);
    }

    session.dispose();
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
