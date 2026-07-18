---
id: enumerate
output:
  subjects: array
role: explore
functions: []
canDelegateTo:
  - system-vision/vision
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
  const imageIds = documents
    .filter((d) => d && d.mediaType && String(d.mediaType).startsWith('image/'))
    .map((d) => d.attachmentId);
  const visionDetail = imageIds.length > 0
    ? await delegate('system-vision', 'vision', {
        query: 'Describe everything visible in detail: every distinct item or subject, its own color/material/markings/state, and how many of each.',
        attachmentIds: imageIds,
      })
    : '';
---

Name every distinct real-world SUBJECT in the supplied material — a NAMING pass, before any specialist
scope is built. The host has already read every supplied document into `documents` (an image attachment
comes back `{kind:'unsupported'}` there — a document reader cannot see a picture); `request`,
`sourceSummary`, `attachmentIds`, and `specialistFacts` are also in scope, and the source text is
authoritative over the short summary. **This now includes images**: `visionDetail` is this task's OWN
direct description of every image attachment, delegated straight to the vision specialist in the
prelude above — read it for what an image actually shows instead of trusting `specialistFacts`' one-line
paraphrase of it, which routinely drops the distinguishing detail that makes an item its own subject (a
caller's summary of a photo is not the photo). Do not write research notes yet, and do not consolidate —
a later step merges genuine near-duplicates, so over-listing here is safe and under-listing is the
failure to avoid.

**You do not carry the splitting rules yourself — they live in loadable knowledge, so the right
heuristic for THIS kind of material is always available.** Work in two reads:

1. **See the menu + the real option list.** `await loadKnowledge('organizing', 'split')` returns the
   index — the universal rule (a specialist is a subject the user would ASK for advice on; a category of
   their own records — costs, dates, payments, photos, contacts, a list/tracker/dashboard/overview — is
   app DATA, a table, never a specialist) — with the REAL, current option names appended underneath
   ("Available options: …", read straight off the actual files on disk, so it can never drift stale).
2. **Load the guide(s) for this material — by an EXACT name from that appended list, never a guessed
   synonym.** From what `documents` actually contain and what `request` asks, pick the name(s) that
   literally appear in the "Available options" list you were just given; do not infer a plausible-sounding
   domain word that isn't on it (a word like "inventory", "sales", or "studio" is not a guide just because
   it sounds related to the material). Load each:
   `await loadKnowledge('organizing', 'split', '<exact-name-from-the-list>')` (a mixed pile loads
   several). If nothing on the list fits, load `'default'` directly. Read that guidance — it tells
   you the axis this domain splits on and which of its parts are subjects vs. mere records.

**Read each guide's OWN granularity rule and apply it LITERALLY — one list entry per instance it names,
never one combined entry for the whole domain.** A guide that splits "by each PET" means: two pets named
in the material is two entries, one per animal — never a single "pets" entry. A guide that splits "by
each standing home domain" means: one entry per domain the material actually touches (the electricity
supply, the home insurance, the boiler service — each its own entry), never a single "household" or
"bills" entry that folds them together. **A part with FEW facts is still its own entry** — brevity is
never a reason to leave it out or fold it into a bigger one; that is exactly the failure this naming
pass exists to prevent, because a free-form pass that builds full scopes AND decides membership in the
same breath is where a small, distinct part quietly gets absorbed into a catch-all. The next step
consolidates genuine near-duplicates — that is where two names for the same thing collapse, not here.

Emit exactly one statement — a short label per subject, nothing else:

```typescript
currentTask.resolve({ subjects: [ '<distinct real-world subject, one per guide-defined instance>' ] });
```
