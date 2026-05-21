#!/usr/bin/env tsx
// Eval runner — invokes per-lib grade.ts based on --lib <name> and --model <class> args.
// No-op when no grade.ts exists yet.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const { values } = parseArgs({
  options: {
    lib: { type: 'string' },
    model: { type: 'string' },
  },
  allowPositionals: true,
});

const lib = values.lib;
const model = values.model ?? '30b';

if (!lib) {
  console.error('Usage: eval.ts --lib <name> [--model <class>]');
  process.exit(1);
}

// Model class → env alias mapping
const MODEL_ALIASES: Record<string, string> = {
  '1b': 'LM_MODEL_XS',
  '3b': 'LM_MODEL_XS',
  '7b': 'LM_MODEL_S',
  '14b': 'LM_MODEL_S',
  '30b': 'LM_MODEL_M',
  '70b': 'LM_MODEL_M',
  'frontier': 'LM_MODEL_L',
  'reasoning': 'LM_MODEL_M_R',
};

const alias = MODEL_ALIASES[model];
if (!alias) {
  console.warn(`Unknown model class: ${model}. Known: ${Object.keys(MODEL_ALIASES).join(', ')}`);
}

const modelId = alias ? process.env[alias] : undefined;
if (!modelId) {
  console.warn(`Warning: env var ${alias} not set — skipping eval for model class "${model}"`);
  process.exit(0);
}

const gradePath = resolve(__dirname, '..', 'src', 'lib', lib, 'eval', 'grade.ts');
if (!existsSync(gradePath)) {
  console.log(`No grade.ts found at ${gradePath} — skipping (not yet implemented)`);
  process.exit(0);
}

console.log(`Running eval for lib="${lib}" model="${model}" (${modelId})`);
const { run } = await import(gradePath);
await run({ lib, model, modelId });
