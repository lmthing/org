---
title: Broad survey
description: Many providers, shallow reads — map the landscape
order: 1
---

# Broad survey

Use when the user wants to map a topic, not nail a specific fact.

**Recipe**
1. searcher → run **3+ providers in parallel** (Brave + Tavily + Exa) — different indexes find different sources.
2. searcher → return top 15 unique URLs ranked by score.
3. reader → for each URL, **fetchPage with `byteBudget: 8000`** (snippet-grade, not full read).
4. synthesizer → cluster findings; flag where sources agree/disagree.
5. ask the user which cluster to drill into → switch to `deep` mode.

**Why it works**: cheap fan-out per source keeps context low. Only spend budget once you know which sources matter.
