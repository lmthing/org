---
name: new-provider
description: Load when adding a new AI provider (azure/anthropic/openai/google/mistral) via a Vercel AI SDK adapter.
---

# Skill: Adding a New AI Provider

Providers are resolved in `packages/cli/src/providers/resolve.ts`. Each provider maps to a Vercel AI SDK adapter.

## Steps

### 1. Install the SDK adapter

```bash
pnpm --filter @repl/cli add @ai-sdk/<provider>
```

### 2. Add a `case` in `packages/cli/src/providers/resolve.ts`

```typescript
case '<provider>': {
  const { createProvider } = await import('@ai-sdk/<provider>');
  const client = createProvider({
    apiKey: process.env['PROVIDER_API_KEY'],
    // other config from env
  });
  return client(modelId);
}
```

The `provider` and `modelId` strings come from splitting the alias on `:` — e.g. `azure:DeepSeek-V4-Flash` → `provider = 'azure'`, `modelId = 'DeepSeek-V4-Flash'`.

### 3. Add model aliases to `.env`

```bash
LM_MODEL_XS=<provider>:<modelId>
LM_MODEL_M=<provider>:<modelId>
```

### 4. Test it

```bash
node packages/cli/dist/cli/bin.js --model <provider>:<modelId> --space ./fixtures/cooking "hello"
```

## Azure specifics

Azure requires `AZURE_RESOURCE_NAME` and `AZURE_API_KEY`. The model ID is the deployment name (not the canonical model name).

## Alias resolution

Aliases live in `packages/cli/src/providers/aliases.ts`. The `resolveAlias(str)` function:
1. Checks if `str` matches a known single-letter alias (XS, S, M, L, L_R, M_R)
2. Reads `process.env['LM_MODEL_' + alias]` for the full provider:modelId
3. Falls through to return `str` as-is if not an alias

To add a new alias letter, extend the union type and the env var map in `aliases.ts`.
