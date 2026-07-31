---
description: LOAD WHEN you have decided to build a REUSABLE agent/tool/workflow (path 3) — before the first turn of it. The two-turn build_specialist pipeline, and the much cheaper direct-architect route for when the user ALREADY gave you the material.
---

# Path 3 — build a new specialist

For when the user wants a REUSABLE agent/tool/workflow, or the job is a recurring specialized task
no existing agent covers (including any "research X and build a space/agent that …" request). The
`build_specialist` tasklist runs the WHOLE pipeline for you (deep research → architect
design/scaffold/validate/register) — you run TWO turns:

```typescript
// Turn 1 — run the structural build pipeline. b = { ok, degraded, data }; the built
// agent's run coordinates are b.data ({ spaceKey, agentSlug, actionId, query, ok, errors }).
const b = await tasklist('build_specialist', { request: '<the user request, verbatim>' });
```

```typescript
// Turn 2 — run the freshly-built agent and show its answer. Only delegate when the
// build+register succeeded (b.ok && b.data.ok); otherwise surface the error — NEVER
// try to build it yourself.
const result = (b.ok && b.data.ok)
  ? await delegate(b.data.spaceKey, b.data.agentSlug, b.data.actionId, { query: b.data.query, context: {} })
  : { error: 'The build pipeline could not build the agent: ' + (b.data && b.data.errors ? b.data.errors : String(b.reason ?? 'unknown')) };
// Read result yourself, then tell them what it found. Never dump it.
```

When `b.degraded` is true but the build succeeded, still run the agent — just add a brief
note to the user that it was built with limited research (the research pass was degraded).
The new space stays registered under this project for later requests.

## When the material is ALREADY PROVIDED for a SINGLE standalone specialist

(The user asked for ONE specific expert grounded in content they gave you — NOT an accepted offer
to organise a dump, which is `organize_material` and builds every specialist for you.)

DO NOT run `build_specialist`/deep research — that pipeline is for building an expert on a NEW
domain from scratch, and re-researching what the user already handed you is both wrong and far too
slow. Build that ONE space DIRECTLY from the provided content by delegating to the architect with
the content seeded as `context.research` (the architect does NOT re-research when handed a report —
it builds straight from it):

```typescript
// ONE standalone specialist, grounded in the provided content — no web research. This is a single
// build, never a loop over the topics in a dump (that dump is organize_material's job, not yours).
// `research` MUST be a JSON string.
const built = await delegate('system-architect', 'architect', 'synthesize_and_run', {
  query: 'Build a specialist space for <the one topic the user named>.',
  context: {
    topic: '<the topic>',
    goal: 'Answer questions about <the topic> from the provided details.',
    research: JSON.stringify({
      topic: '<the topic>',
      executive_summary: '<one-line summary>',
      findings: [{ heading: '<facet>', detail: '<the relevant facts from the provided content, verbatim>' }],
      conclusion: '', sources: [],
    }),
  },
});
```

This is dramatically cheaper than `build_specialist` (no research fork). Build the one requested
specialist, then return to the user's request.

## App vs specialist

Path 3 builds an *expert agent* (knowledge + reasoning). If the user wants an **application** —
something with its own stored DATA plus a web UI and/or automation (a feed, tracker, dashboard,
list/CRUD tool, "an app that lets me …", "build me something to store/track/manage X") — that is
path 4, NOT path 3.
