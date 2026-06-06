---
title: Exa (Metaphor)
description: Neural / semantic search; finds pages by what they're like
envVar: EXA_API_KEY
strengths: academic, deep, "find pages like this"
order: 3
---

# Exa

Embedding-based semantic search. Excels when the query is conceptual rather than keyword-matchable, and at finding "more pages like this URL". Built-in highlights and full-page content extraction.

**When to use**
- Academic / research-paper discovery
- Conceptual queries ("how do diffusion models compare to flow matching")
- Expanding from a known good URL via `find_similar`

**Tip**: pass `type: "neural"` for fuzzy concept matches; `"keyword"` for exact terms.
