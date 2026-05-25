---
title: JSON Feed
description: JSON Feed — modern feed format using JSON instead of XML
---

## JSON Feed

A modern feed format (JSON Feed version 1.1) that uses JSON instead of XML. Easier to parse but less widely supported. Used by some modern platforms and blogs.

### Common URL patterns

- `/feed.json`
- `/json-feed/`
- `/.well-known/feed.json`

### Key fields

- `title` — Feed title
- `items[].title` — Article headline
- `items[].url` — Article URL
- `items[].content_html` — Full content as HTML
- `items[].content_text` — Full content as plain text
- `items[].summary` — Article summary
- `items[].date_published` — Publication date (ISO 8601)
- `items[].authors[].name` — Author name
- `items[].tags[]` — Topic tags
- `items[].id` — Unique identifier
- `items[].image` — Featured image URL

### Advantages

- Native JSON — no XML parsing needed
- Explicit content types (HTML vs plain text)
- Built-in author array (multiple authors supported)
- Standardised language field
- Built-in hubs field for WebSub support
