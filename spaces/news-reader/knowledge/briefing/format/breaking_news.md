---
title: Breaking News
description: Urgent, time-critical news format — minimal latency, maximum signal
---

## Breaking News Format

A fast, focused briefing that surfaces only the most recent and urgent stories. Designed for real-time awareness, not comprehensive coverage.

### Structure

```
# Breaking News — <date> <time>

## [BREAKING] <headline>
<1-2 paragraph summary>
Source: <source> | Published: <time> | Confidence: <score>

---

## Also developing
- **<headline>** — [source](url) <time>
- **<headline>** — [source](url) <time>
- ...
```

### Content rules

- Only stories from the last 4 hours
- Maximum 10 stories total
- Lead story gets full summary; others get one-liners
- All stories must be from sources with credibility >= 0.7
- Unverified claims explicitly tagged [UNVERIFIED]
- Include timestamp for every story
- No opinion pieces — hard news only
- If no truly breaking stories, say "No breaking news at this time" rather than padding
