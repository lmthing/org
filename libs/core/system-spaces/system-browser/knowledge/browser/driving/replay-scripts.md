---
description: How to distill a finished browsing session into ONE reusable Lightpanda agent script (.js) — the equivalent of Lightpanda's own /save. Load when asked to produce a replayable script.
---

# Distilling a session into a replayable script

When the user asks you to save, record, or produce a reusable script from what you just did, write ONE
Lightpanda agent script (`.js`) that, run later on its own, redoes what the user set out to accomplish.
You are reproducing the user's goal, not replaying the transcript.

- Infer the goal from the whole conversation, including corrections — the user's final intent wins over
  their first phrasing.
- Keep only the steps a clean re-run needs, in the order that worked. Drop failed attempts, retries,
  dead ends, and exploratory reads (tree/markdown/extract probes that only informed your next move).
- Reasoning you did between calls — comparing, filtering, picking, aggregating across pages — becomes
  plain top-level JavaScript, so the script reaches the result without you.

## Script rules

- `Page` is the only global. `new Page()` makes a page; `await page.goto(url)` navigates it (async —
  always `await`). Every other builtin is a synchronous method on that page: `const data =
  page.extract({...})`, never `await page.extract`. The file runs as an async script, so top-level
  `await` is allowed.
- Read pages with `page.extract(schema)` — CSS selectors lift text and attributes as strings, and every
  trim/split/regex/parse/merge on those strings is plain top-level JavaScript in the script context.
  `page.evaluate(...)` is ONLY for JS that must run inside the page and no builtin covers — never a
  querySelector-and-parse block. It cannot see script variables (interpolate values into its string),
  and page state is wiped by every navigation while script variables persist.
- `return <value>` is the script's output, printed automatically (objects/arrays as JSON). End with
  `return page.extract({...});` or `return results;` — a bare trailing expression is not printed, and
  neither is `console.log` or `JSON.stringify`.
- Modern, readable JS: `const`/`let`, `for (const x of xs)`, template literals, destructuring, 2-space
  indent.
- Stay faithful to the calls that worked: same arguments and options each one actually used. Do NOT add
  a `timeout` (or any option) the session didn't use.
- Annotate the script with short `//` intent comments: one comment above each logical block (navigate,
  extract a list, fan out to detail pages, aggregate, return) stating what that block accomplishes toward
  the goal — NOT restating the API call. One comment per step, not per line.

Output ONLY JavaScript source — no markdown fences and no prose outside the code, but DO annotate the
script with the `//` intent comments described above.

## Why CSS selectors, not backendNodeId

Selector-based `click`/`fill`/`extract` calls survive replay as reusable JavaScript; `backendNodeId`
targets are session-local ids that mean nothing in a fresh run. Driving by CSS selector throughout the
live session (see the selector rules in the overview) is what keeps a session distillable at all.
