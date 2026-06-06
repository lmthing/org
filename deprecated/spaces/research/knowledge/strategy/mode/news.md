---
title: News / current events
description: Time-bounded; freshness filters; news-tuned providers
order: 3
---

# News

Use for "what happened today/this week" questions or evolving stories.

**Recipe**
1. searcher → Tavily (`topic: "news"`) + Brave (`freshness: "pd"` or `"pw"`) + Perplexity (`search_recency_filter: "week"`).
2. reader → fetch top hits with `byteBudget: 12000` — news articles are usually short.
3. synthesizer → **timeline format**: bullets sorted by publish date, each cited.
4. Flag conflicting accounts as such — don't average them.
