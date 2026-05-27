#!/usr/bin/env tsx
// Eval runner — invokes per-lib grade.ts based on --lib <name> and --model <alias> args.
// No-op when no grade.ts exists yet.
//
// --model accepts the env alias directly: XS | S | M | M_R | L | L_R
// Each alias resolves to LM_MODEL_<ALIAS> in the environment, then to a real
// provider:modelId string which is resolved via llm-repl-cli's provider factory.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const { values } = parseArgs({
  options: {
    lib: { type: 'string' },
    model: { type: 'string' },
    role: { type: 'string' },
  },
  allowPositionals: true,
});

const lib = values.lib;
const alias = (values.model ?? 'M').toUpperCase();

if (!lib && !values.role) {
  console.error('Usage: eval.ts --lib <name> [--model <alias>]');
  console.error('       eval.ts --role <ROLE> [--model <alias>]');
  console.error('');
  console.error('Model aliases: XS | S | M | M_R | L | L_R');
  process.exit(1);
}

// Valid aliases
const KNOWN_ALIASES = ['XS', 'S', 'M', 'M_R', 'L', 'L_R'];
if (!KNOWN_ALIASES.includes(alias)) {
  console.error(`Unknown model alias: "${alias}". Valid: ${KNOWN_ALIASES.join(' | ')}`);
  process.exit(1);
}

const envVar = `LM_MODEL_${alias}`;
const modelSpec = process.env[envVar];

if (!modelSpec) {
  console.warn(`Warning: ${envVar} is not set — skipping eval for alias "${alias}"`);
  process.exit(0);
}

// Resolve the model spec (e.g. "azure:claude-sonnet-4-6") to a LanguageModelV1 instance
// Import directly from llm-repl-cli source so tsx resolves TS without a build step
const resolverPath = resolve(
  __dirname,
  '../../llm-repl-cli/src/providers/resolver.ts',
);
const { resolveModel } = await import(resolverPath);
const model = resolveModel(modelSpec);

// Dispatch to the per-lib or per-role grader
if (lib) {
  const gradePath = resolve(__dirname, '..', 'src', 'lib', lib, 'eval', 'grade.ts');
  if (!existsSync(gradePath)) {
    console.log(`No grade.ts at ${gradePath} — skipping (not yet implemented)`);
    process.exit(0);
  }

  console.log(`Running eval: lib="${lib}" alias="${alias}" model="${modelSpec}"`);
  const { run } = await import(gradePath);
  await run({ lib, alias, modelSpec, model });
}

if (values.role) {
  const role = values.role;
  const gradePath = resolve(__dirname, '..', '..', 'llm-repl-cli', 'src', 'router', 'eval', 'grade.ts');
  if (!existsSync(gradePath)) {
    console.log(`No router grade.ts at ${gradePath} — skipping (not yet implemented)`);
    process.exit(0);
  }

  console.log(`Running eval: role="${role}" alias="${alias}" model="${modelSpec}"`);
  const { run } = await import(gradePath);
  await run({ role, alias, modelSpec, model });
}
