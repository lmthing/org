---
name: new-provider
description: Load when adding a new AI provider (azure/anthropic/openai/google/mistral) via a Vercel AI SDK adapter.
---

# Skill: Adding a New AI Provider

Load this when you need the runtime to reach a new model or vendor. "Provider" means three
different things in lmthing, wired in three different places — **identify which one you need
before touching code**, then follow the grounded steps in the doc:

| You want to… | Doc section |
|---|---|
| Offer a new model on the managed `lmthing.cloud` proxy (what user pods call by default) | `org/docs/contributing/add-a-provider.md` §A |
| Call a new LLM vendor directly with its own API key (a `case` in `resolve.ts`) | `org/docs/contributing/add-a-provider.md` §B |
| Add a web-search backend for the agent `webSearch()` global | `org/docs/contributing/add-a-provider.md` §C |

## Read first

- `org/docs/contributing/add-a-provider.md` — the three paths, every step, every file + line cite.
- `org/docs/cloud/litellm.md` — LiteLLM architecture, `model_list`, `ENABLED_MODELS`, pricing/markup.
- `org/docs/cloud/billing-and-tiers.md` — tier key allowlists and budget impact of a new model.
- `org/docs/cli-api/commands.md` — `--model`, model aliases, provider env vars.

## Procedure

**Managed model (§A)** — after editing `ENABLED_MODELS` (gateway + pricing generator, they must
match) and adding prices to `sdk/org/libs/cli/prices/azure.json`:

```bash
cd cloud && pnpm litellm:generate-models     # prints the model_list block
# paste into devops/argocd/core/litellm.yaml, then:
kubectl rollout restart deploy/litellm -n lmthing   # ConfigMap changes do NOT roll pods
```

**Raw AI-SDK provider (§B)** — add the adapter, then a `case` in
`sdk/org/libs/cli/src/providers/resolve.ts`:

```bash
pnpm --filter @lmthing/cli add @ai-sdk/<provider>
```

Copy the conventions from the existing cases (lazy `await import`, `.chat(modelId)` on
OpenAI-compatible surfaces, `as unknown as LanguageModel`, throw on missing creds) and update
the `default` error string. Audio? The transcription path is a **separate** switch in
`providers/transcribe.ts`.

Point an alias at it with **no code change** — `resolveAlias` reads `LM_MODEL_<NAME>` generically:

```bash
LM_MODEL_M=<provider>:<modelId>
```

Test:

```bash
node sdk/org/libs/cli/dist/cli/bin.js --model <provider>:<modelId> --space ./fixtures/cooking "hello"
```

**Search provider (§C)** — unit tests stub `fetch`:

```bash
cd sdk/org && pnpm test libs/core/src/spaces/system-functions
```

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in
the same change (see `org/docs/SYNC.md`). After adding a provider: §A → `org/docs/cloud/litellm.md`;
§B → `org/docs/contributing/add-a-provider.md` (its list of implemented cases) + `org/docs/runtime/`;
§C → `org/docs/cloud/render.md`.
