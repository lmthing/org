#!/usr/bin/env node
/**
 * llm-repl CLI binary — Phase 13
 *
 * Parses CLI args and calls runSession().
 * Prints reconstruction to stdout.
 */
import { parseArgs } from './args.js';
import { runSession } from './run.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`llm-repl: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const provider = args.model ?? process.env['LM_MODEL_S'] ?? 'openai:gpt-4o-mini';
  const baseDir = join(tmpdir(), 'llm-repl-sessions');
  const userMessage = args.file ?? '';

  if (!userMessage) {
    console.error('llm-repl: a file path or message is required');
    process.exit(1);
  }

  let result;
  try {
    result = await runSession(
      {
        sessionId: randomUUID(),
        baseDir,
        provider,
        spaceDir: args.spaces?.[0],
        systemPromptExtra: args.instruct?.join('\n'),
      },
      userMessage,
    );
  } catch (err) {
    console.error(`llm-repl: session error — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(result.reconstruction);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
