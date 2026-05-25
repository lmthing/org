---
title: Feed Management
description: Add, remove, list, or import RSS feed subscriptions
defaultAgent: curator
maxCycles: 3

sink:
  name: submitFeedAction
  signature: (result: { action: string; feeds: string[]; message: string }) => void
  description: Confirm the feed management action and return the updated subscription list

tasks:
  load:
    description: Load the current feed subscription list from the space.
    outputSchema:
      type: object
      required: [feeds]
      properties:
        feeds: { type: array, items: { type: string } }
  execute:
    description: Execute the feed action (add, remove, import, list). Validate URLs before modifying.
    dependsOn: [load]
    outputSchema:
      type: object
      required: [feeds, action, message]
      properties:
        feeds: { type: array, items: { type: string } }
        action: { type: string }
        message: { type: string }
  submit:
    description: Persist the updated feed list and submit via sink.
    dependsOn: [execute]
---

Simple feed management flow:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Execute | `load` → `execute` → `submit` | `curator` |
