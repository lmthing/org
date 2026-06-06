---
title: Atom
description: Atom Syndication Format — IETF standard feed format
---

## Atom Feed

IETF-standardised format (RFC 4287). More consistent than RSS 2.0 but less common. Used by Blogger, Google News, and many modern CMS platforms.

### Common URL patterns

- `/atom.xml`
- `/feed/atom/`
- `/feeds/posts/default` (Blogger)
- `/atom/`

### Key fields

- `<title>` — Article headline
- `<link href="..." />` — Article URL (in href attribute, not text content)
- `<summary>` — Article summary
- `<content>` — Full article content
- `<updated>` / `<published>` — Dates (ISO 8601)
- `<author><name>` — Author name
- `<category term="..." />` — Tags (in term attribute)
- `<id>` — Unique identifier (often a URI)

### Advantages over RSS 2.0

- Strict ISO 8601 dates — no parsing ambiguity
- Content can be explicitly HTML or plain text via `type` attribute
- Standardised link relations
- Unique IDs are required
