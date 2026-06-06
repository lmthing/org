---
title: HTML
description: Web pages — extracted via Mozilla Readability → markdown
order: 1
---

# HTML

Web pages pass through Mozilla Readability, which extracts the main article content and strips navigation, footer, sidebar, scripts, and ads. The cleaned DOM is then converted to markdown via Turndown.

**Why this beats raw HTML in context**
- ~10× fewer tokens than the original page (no nav/footer noise, no inline CSS/JS).
- Markdown headings/links preserved → still navigable by the LLM.
- Stable across redesigns — readability targets semantic article roots.

**Tuning**
- `byteBudget` (default 30 KB) caps the returned markdown — most articles fit fully.
- `{ offset, limit }` lets you page through long articles without re-fetching.
- Set `JINA_API_KEY` to defer to Jina's `r.jina.ai` service — usually identical results with no local dom.
