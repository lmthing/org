---
description: Path 2 — research the web; picking research vs deep_research vs the browser, and when a space cannot know the answer.
---

# Path 2 — research the web

For a request that needs current/external facts, sources, or investigation **as the final answer**.
Do NOT use this when the request is "research X AND build a space/agent" — that is path 3; the
architect does its own deep research, so a separate research pass here just doubles the work.

**A space you built from the user's own material knows ONLY that material.** Once a topic has a
space, it is tempting to send every question about that topic to it — but if you built it from
what the user handed you, it cannot know anything they didn't. So when the question turns on a
fact that was NOT in their material — an official rule, a current price, a validity period, an
eligibility condition, what some authority requires — delegating to the space does not produce
an answer, it produces a **confident guess**, and the user cannot tell the difference. RESEARCH
it instead. Ask yourself before you route: *was this in what they gave me?* If no, the web is the
only honest source.

And if you DID route it to a space and it told you its notes don't cover that — **believe it, and
escalate.** A specialist saying "that isn't in what I was given" is doing its job; relaying that
shrug to the user, or dressing it up into an answer anyway, is failing at yours. Go look it up.

Then KEEP what you found: hand the finding back to the space that owns the topic (path 3's
already-provided shortcut) so it is genuinely known next time, and record it wherever the user
will look for it. A researched fact that lives only in one chat reply is one you will pay to
look up again.

## Pick the depth

- **Default depth** → the `research` action (one fast search, concise sourced answer).
  Use this for ANY plain research request — "research X", "look up X", "what's the
  current state of X" — unless the user EXPLICITLY asks for depth. Topic breadth alone
  is NOT a reason to escalate; `research` handles broad topics with one good search.
  A tasklist-backed delegate resolves to `{ ok, degraded, data }` — the payload is `.data`:

```typescript
const r = await delegate('system-research', 'researcher', 'research', { query: '<the question>' }) as {
  ok: boolean; degraded: boolean; reason?: string; degradedTasks?: string[];
  data: { answer: string; sources: Array<{ title: string; url: string }> };
};
// Read r.data yourself, then ANSWER them — in their words, with the sources. Never dump it.
```

- **Deep dive — ONLY on explicit request** → the `deep_research` action (parallel
  multi-angle investigation, cited report). Reserve this for when the user says "deep",
  "thorough", "comprehensive", asks for a report/analysis of multiple angles, or a prior
  `research` answer proved insufficient. It costs ~10× more than `research`:

```typescript
const rep = await delegate('system-research', 'researcher', 'deep_research', { query: '<the topic>' }) as {
  ok: boolean; degraded: boolean; reason?: string; degradedTasks?: string[];
  data: { topic: string; executive_summary: string;
    findings: Array<{ heading: string; detail: string }>;
    conclusion: string; sources: Array<{ title: string; url: string }> };
};
// Read rep.data yourself, then write them the answer. Never dump the raw report object.
```

- **Interactive browsing → the `browser` agent.** When the task needs a real browser to *act on
  a specific site* rather than a read-only search — log in, fill and submit a form, click through
  a multi-step flow, page through results, or extract structured data from a known page (including
  JS-heavy sites a plain search/fetch comes back empty on) — delegate to the browser. It drives a
  headless Lightpanda browser (navigate/click/fill/extract) and, like vision, resolves to a
  plain-text answer (it has no actions — use the 3-arg form, no action id):

```typescript
const answer = await delegate('system-browser', 'browser', {
  query: '<what to do on the web, e.g. "log in to example.com and read my latest invoice total">',
}) as string;
// Read `answer` yourself, then tell the user. Never dump it.
```

Choose between the two: `research` for "look something up / current facts / who-what-when" —
it is cheaper and returns sources; `browser` when the answer requires *navigating or
interacting with a particular site* (auth, forms, buttons, or scraping one page's structure).
If a `research` pass comes back empty because the page is interactive or gated, escalate to
`browser`.
