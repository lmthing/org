# research — deep web research space

## Run

The driver lives in `llm-repl-cli`. From the repo root:

```bash
pnpm --filter @lmthing/llm-repl-cli research \
  "<your question>" \
  [--space <path>] \
  [--mode broad|deep|news|academic] \
  [--model L|M|S|...] \
  [--cycles N] [--max N] [--read N] [-v]
```

Defaults: `--space ../../spaces/research`, `--mode broad`, `--model L`, `--cycles 4`.

The driver boots a full `@lmthing/llm-repl` runtime (sandbox + L0–L8 engines), loads this space via `loadSpaceFromDisk`, dynamically imports `hostFunctions` from `./index.ts`, injects them as host-bridged QuickJS globals, and drives the LLM through an `inspect()`-loop until it calls `submitBrief(...)`.

Every cycle's TypeScript is type-checked + transpiled via `runTsc` with `HOST_AMBIENT_DTS` providing ambient declarations for the host globals.

### Outputs

- Brief is printed to stdout.
- Full session manifest at `<sessionDir>/session.json` — every cycle's system prompt, user prompt, assistant text, transpiled JS, diagnostics, errors, inspect call args, and final brief. Written incrementally so you can review even a killed run.
- `<sessionDir>/trace.jsonl` — runtime trace events (space loading, inspect, brief submission, errors).
- `<sessionDir>/space/` — the rehydrated space template inside the session.

### Env

In `/home/vasilis/LMTHING/org/.env`:
- At least one search-provider key (see table below).
- `LM_MODEL_<ALIAS>` resolved to `provider:modelId` (e.g. `azure:gpt-5.5`), plus the matching provider creds (`AZURE_API_KEY` + `AZURE_RESOURCE_NAME`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

---



Multi-provider web search, context-efficient page navigation, and document extraction (HTML, PDF, DOCX, plain text).

## Agents

| Agent | Role |
|-------|------|
| `searcher` | Picks the best search provider(s) for the query, runs queries, dedupes/ranks results |
| `reader` | Fetches pages and documents, extracts the relevant slice in token-efficient form |
| `synthesizer` | Aggregates findings across sources into a cited brief |

## Functions

| Function | Description |
|----------|-------------|
| `webSearch(query, opts?)` | Unified search across all configured providers (Tavily, Brave, Serper, Exa, Perplexity, Kagi, Google CSE, Bing, DuckDuckGo) |
| `fetchPage(url, opts?)` | Fetch + extract main content as markdown (Readability) with byte budget |
| `readPdf(url, opts?)` | Stream-parse a PDF; return text by page range or token budget |
| `readDocument(url, opts?)` | Auto-route by content-type: HTML, PDF, DOCX, plain |
| `siteMap(url, opts?)` | Enumerate a site's structure (sitemap.xml / crawl) |
| `extractLinks(url, opts?)` | Pull outbound links from a page, filtered + ranked |

## API keys (env vars)

| Provider | Env var |
|----------|---------|
| Tavily | `TAVILY_API_KEY` |
| Brave Search | `BRAVE_SEARCH_API_KEY` |
| Serper | `SERPER_API_KEY` |
| SerpAPI | `SERPAPI_API_KEY` |
| Exa | `EXA_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| Kagi | `KAGI_API_KEY` |
| You.com | `YOU_API_KEY` |
| Google CSE | `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX` |
| Bing | `BING_SEARCH_API_KEY` |
| Jina Reader (HTML→markdown) | `JINA_API_KEY` (optional; works without) |
| DuckDuckGo | — (no key) |

Missing keys cause the matching provider to be skipped silently in `webSearch`; calling a provider directly throws with the missing-var name.

## Context efficiency

- HTML pages pass through Mozilla Readability → markdown, stripped of nav/footer/sidebar/script.
- All fetchers default to a `byteBudget` (~30 KB) and a `chunk` window (`{ offset, limit }`) so the LLM reads slices, not whole documents.
- PDFs are parsed page-by-page; `pages: "1-5"` reads a range.
- Repeated fetches within a session hit a content-addressed cache (`space/.cache/`).
- `webSearch` returns title + snippet + URL only — never page bodies. Bodies are pulled lazily via `fetchPage`.
