---
title: Deep dive
description: Few sources, full reads, follow links
order: 2
---

# Deep dive

Use when you already have a short list of authoritative sources and need to extract a specific answer.

**Recipe**
1. searcher → 1 high-precision provider (Exa for academic, Tavily for news, Brave for general).
2. reader → full `fetchPage` (`byteBudget: 30000`) on top 3 hits.
3. reader → `extractLinks` from each page; queue outbound links that look on-topic.
4. checkpoint() before each new fetch — easy to rollback if a tangent doesn't pay off.
5. synthesizer → cite specific paragraphs / page numbers.

**Why it works**: depth-first with checkpointing lets you backtrack cheaply when a path doesn't pan out.
