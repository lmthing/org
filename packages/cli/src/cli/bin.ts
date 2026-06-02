#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

import { Session } from '@repl/core';
import { parseArgs } from './args.js';
import { resolveAlias } from '../providers/aliases.js';
import { resolveModel } from '../providers/resolve.js';
import { createStream } from '../stream/stream.js';
import { InkRenderHost } from '../render/ink-renderer.js';
import { WebRenderHost } from '../rpc/server.js';
import { startWebServer } from '../web/serve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const modelSpec = resolveAlias(args.model ?? process.env['LM_MODEL'] ?? 'M');
  const model = await resolveModel(modelSpec);

  const streamFn = (opts: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => createStream({ model, ...opts });

  const agentSlug = args.agent ?? process.env['LM_AGENT'] ?? 'default';

  if (args.webPort) {
    // Web mode: load space, start combined HTTP+WS server, open browser
    const { loadSpace } = await import('@repl/core');
    const space = await loadSpace(args.space);

    const renderHost = new WebRenderHost();
    const session = new Session(
      {
        spaceDir: args.space,
        agentSlug,
        modelAlias: modelSpec,
        renderHost,
        traceFile: args.traceFile,
      },
      { streamFn },
    );

    // __dirname is dist/cli/ at runtime; app.tsx is at dist/web/app.tsx
    const appTsxPath = join(__dirname, '..', 'web', 'app.tsx');
    await startWebServer({ port: args.webPort, session, renderHost, space, agentSlug, appTsxPath });
    // Keep process alive
  } else {
    // Terminal mode: use Ink renderer
    const renderHost = new InkRenderHost();
    const session = new Session(
      {
        spaceDir: args.space,
        agentSlug,
        modelAlias: modelSpec,
        renderHost,
        traceFile: args.traceFile,
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
