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
  } else if (args.repl) {
    // Interactive REPL mode: persistent session, multi-turn conversation
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
