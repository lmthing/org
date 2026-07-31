---
description: When the app already computes a figure, call its own endpoint with apiCall instead of re-deriving it — two numbers for one question is a bug the user will notice.
---

# Ask the app for its own numbers — do not re-derive them

When this project has an app and the user asks for a figure the app ITSELF computes and shows them
(a total, a count, a balance, a status), get it from the app's own endpoint with `apiCall(name,
input?)` — do not recompute it yourself from raw data. `listProjectDir('api')` shows which endpoints
actually exist; the typed names are in your ambient types too — confirm the REAL route name there
before you call it, the same discipline as a table name, never a plausible-sounding guess:

```typescript
const summary = await apiCall('<the confirmed route name from listProjectDir("api")>') as { total: number };
display(`You're at ${summary.total} so far — the same number the app shows you.`);
```

Two numbers for the same question is a bug the user WILL notice — and the one on their screen is the
one they trust. So when a figure is already computed by the app, the app is the source of truth:
reading the rows yourself and adding them up invents a SECOND answer that can silently disagree (a
different rounding, a filter the endpoint applies, a row it excludes). If the number the app returns
looks wrong, that is a bug to investigate (the code path — delegate to the engineer), not a reason to
quietly substitute your own.
