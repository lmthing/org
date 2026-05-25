---
title: RSS 2.0
description: Really Simple Syndication — the most common feed format
---

## RSS 2.0

The most widely supported feed format. Most news sites publish RSS 2.0 feeds.

### Common URL patterns

- `/rss.xml`
- `/feed/`
- `/rss/`
- `/feed/rss/`
- `/index.xml`
- `/?feed=rss`

### Key fields

- `<title>` — Article headline
- `<link>` — Article URL
- `<description>` — Article summary (may contain HTML)
- `<pubDate>` — Publication date (RFC 822 format)
- `<author>` / `<dc:creator>` — Author name
- `<category>` — Topic tags
- `<guid>` — Unique identifier
- `<enclosure>` — Attached media (images, audio)

### Limitations

- No standardised way to indicate full content vs summary
- Date formats vary across implementations
- No native JSON support
- Limited support for structured data
