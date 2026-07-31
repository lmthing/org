---
description: Retracting a fact, reconciling two disagreeing sources, and fixing a flagged total — the three tasklists that repair stored data rather than re-explain it.
---

# A retraction

("cancel that $30 charge, I never paid it") → `await tasklist('retract_fact', { fact })` — the
tasklist hard-deletes the row in its host-run apply step (you have no `db.remove` yourself — a hard
delete is never something you do inline), then confirm what you removed. Never just apologize and
leave the wrong value in place.

**Before you conclude nothing matches, look properly** — a handful of rows is cheap to read in full,
so don't stop at one guessed keyword that comes back empty. A real match can sit in a related child
row your first query didn't include (`db.query(table, {include: ['<relation>']})`, e.g. line items
under a receipt), or under a different word form than the one you searched for (a plural, a different
language, a supplier's own name for the thing rather than the user's word for it). A genuine miss and
a filter that just didn't try hard enough look identical from where you're sitting — so when the
obvious keyword search is empty, actually read what IS there before telling the user it's gone.

# Two sources disagree

(the app's total vs a number they assert; old research vs a newer statement) → `await
tasklist('reconcile_conflict', { claim, existing })`. Precedence is **user-asserted > DB > researched
> guess**; when two equally authoritative sources collide it asks the user rather than picking
silently.

# A flagged total or figure that doesn't add up

("that looks too high", "can you check the maths", "go through the rows and check the maths", "the
total doesn't match mine", "verify these numbers") is the determined-change case from the act-vs-ask
rule — not a conflict between two asserted values, but a diagnostic-then-fix job over their own data
→ `await tasklist('resolve_flagged_figure', { complaint })` (`complaint` = what they said, verbatim).

**This is NOT a path-1 read-and-answer.** "Check/verify/go through the maths" over their rows READS
like a question, so it is tempting to just re-query, print a corrected table, and stop — but
re-explaining the mistake while leaving the wrong number in the DB is the failure this route exists
to prevent. Route it to the tasklist, which FIXES the stored figure; do not diagnose it inline and
end the turn without a write.

The tasklist diagnoses the concrete cause from the actual rows and, when it can VERIFY in code that
the correction is right and unambiguous, applies the fix and re-reads to confirm it took — you do NOT
stop to ask permission for a repair it could verify. But when it CANNOT verify a destructive change —
the correct value is ambiguous, more than one row could be the culprit, or the figure can't be
recomputed — it writes nothing and returns a `question` for you to relay. On the user's YES,
re-invoke it with the confirmed action rather than a fresh complaint:

```typescript
await tasklist('resolve_flagged_figure', {
  complaint,
  decision: { ...result.decision, approved: true },   // result.decision is the proposal it handed back
});
```

That carries the settled decision straight to the write, so a confirmed fix is never re-litigated
into deleting the wrong row.
