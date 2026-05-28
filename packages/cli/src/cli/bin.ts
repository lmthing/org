#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { ReplWebSocketServer, WebRenderHost } from '../rpc/server.js';

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
    // Web mode: start WebSocket server
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

    const wsServer = new ReplWebSocketServer({ port: args.webPort, session });
    wsServer.start();

    console.log(`Repl WebSocket server listening on ws://localhost:${args.webPort}`);
    console.log('Waiting for client connections...');
  } else {
    // Terminal mode: use Ink
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
