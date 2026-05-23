---
title: Perplexity
description: LLM-aggregated search with citations
envVar: PERPLEXITY_API_KEY
strengths: aggregated answers, multi-hop questions
order: 4
---

# Perplexity

Returns an LLM-synthesized answer plus the citations it used. We extract only the citations (URLs) — the answer is treated as a snippet preview.

**When to use**
- Multi-hop questions where you want pre-aggregated sources
- "Show me sources that discuss X" rather than "answer X"

Use `search_recency_filter` for freshness.
