---
input:
  request: string
---

Build a reusable specialist agent for the user's `request` and return its run coordinates.
The host runs two steps in order: research the domain (via the researcher's deep_research —
optional; the build proceeds even when research comes back empty or degraded), then hand the
request + research to the architect, which designs, scaffolds, validates, and registers the new
agent. The goal output is the built agent's `{ spaceKey, agentSlug, actionId, query, ok, errors }`
so the caller can delegate to it.
