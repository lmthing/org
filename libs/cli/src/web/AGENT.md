# Driving the LMThing web UI as an agent (minimum context)

When `--web <port>` is running, you (an LLM agent) can observe and control a run
**without a browser** through a compact HTTP API on the same port. Everything is
plain text by default (append `?format=json` for JSON). The whole API is
self-describing — `curl -s localhost:<port>/api/help` is the only thing you need
to read first.

## The five things you'll do

```
# 1. Orient — execution tree + pending asks + lastSeq (one screen)
curl -s localhost:3000/api/state

# 2. Drill into a node — tabs: llm | statements | yields | variables | raw
curl -s "localhost:3000/api/node/<nodeId>?tab=statements"

# 3. Tail changes — poll with the lastSeq from step 1 instead of re-reading state
curl -s "localhost:3000/api/events?since=<lastSeq>"        # &type=node_start,node_end &node=<id>

# 4. Interact
curl -s -X POST localhost:3000/api/message -d '{"content":"…"}' -H 'content-type: application/json'
curl -s -X POST localhost:3000/api/ask/<id> -d '{"value":…}' -H 'content-type: application/json'
curl -s -X DELETE localhost:3000/api/ask/<id>

# 5. Point a human at what you found (drives their browser)
curl -s -X POST localhost:3000/api/ui -d '{"select":"<nodeId>","tab":"llm"}' -H 'content-type: application/json'
```

## Reading `/api/state`

An indented ASCII tree, one line per execution node:

```
⟳ <sessionId> [session] session  [q:0/4]
  ✓ run_1_… [run] session  8.9s
    ✓ fork_2_… [fork] fork:general  528ms
    ✗ fork_3_… [fork] fork:general  402ms  ×2     ← ×N = code retried N times
```

Glyphs: `○` queued · `⟳` running · `✓` done · `✗` error · `⊘` skipped.
The `<nodeId>` (e.g. `fork_3_a63…`) is what you pass to `/api/node/<id>` and `/api/ui`.

## Tips

- Poll `/api/events?since=<lastSeq>` rather than re-fetching `/api/state` — far fewer tokens.
- `tab=raw` on a node dumps its trace events verbatim; `tab=variables` shows the
  serialized (truncated) scope snapshot.
- A run blocks on an open `ask` form. `curl /api/asks` lists them; answer with
  `POST /api/ask/<id>`.
- Note: the QuickJS VM runs synchronously and can briefly block the HTTP server
  mid-turn — if a request resets, just retry.

## Browser fallback (when a human is watching)

Every view is a URL — navigating reproduces the exact state, so you can hand a
human a deep link instead of describing clicks:

```
http://localhost:3000/?node=<nodeId>&tab=yields&follow=0
http://localhost:3000/?trace=/trace.jsonl          # replay the current --trace run
```

Tree rows expose `data-node-id`; panes are landmarked (`nav[aria-label=execution tree]`,
`main[aria-label=conversation]`, `aside[aria-label=inspector]`) and tabs carry
`data-testid="inspector-tab-<name>"`, so a DOM snapshot is small and addressable.
