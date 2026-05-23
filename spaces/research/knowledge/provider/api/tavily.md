---
title: Tavily
description: Answer-oriented search API with built-in extraction
envVar: TAVILY_API_KEY
strengths: news, current-events, answer-shaped queries
order: 1
---

# Tavily

LLM-tuned search. Returns ranked URLs with scored snippets and an optional aggregated answer. Strong on recent / news queries.

**When to use**
- Current events, breaking news, recent releases
- Questions that have a known answer somewhere on the public web
- When you want a single API to do both search and short-form snippet extraction

**Key options**
- `topic: "news"` for time-sensitive
- `search_depth: "advanced"` (used by default here) for deeper coverage
- `time_range: "d"|"w"|"m"|"y"` for freshness
