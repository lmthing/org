# Organizing supplied material — how to split it into specialists

When the user hands over a pile of material to put in order, split it into SPECIALIST agents by the
real-world SUBJECTS they will come back to and ASK for advice on — never by categories of their own
records. The test for any candidate: *would the user ASK it something and expect advice grounded in
knowledge of that subject?* If yes, it is a specialist. If it is a bucket of the user's own RECORDS —
costs, dates, payments, photos, contacts, a list, a tracker, a dashboard, an "overview/summary" — it
is app DATA (a table), never a specialist.

Read what the material actually is and what the user asked for, decide which domain(s) it spans, and
load the matching guide(s) for how that domain splits with
`loadKnowledge('organizing','split','<option>')`, using an EXACT name from the **Available options**
list appended to this menu — it is read straight off the guide files on disk, so it is always current;
never infer a plausible-sounding name that isn't on it. A mixed pile can load several. Use the
`default` guide when no domain matches.

## Consolidate to the minimal specialist set

Splitting tends to OVER-PRODUCE — the same subject shows up twice under different words, or a broad
advisor sits next to the very specifics it already covers. Before building, collapse the candidates to
the fewest specialists that are each genuinely DISTINCT. Every extra specialist is a full research +
build that costs time and can fail, so err toward FEWER:

- **Same subject → one specialist.** If two candidates name the same real-world subject or place (even
  with different wording, or one adds a nearby landmark), they are ONE. Merge them; keep the clearer
  name; union what each was going to cover.
- **Facets are not specialists.** Fees, rules, tips, logistics, and history *about the same subject*
  are one specialist that advises on all of them — not one per facet.
- **Drop the redundant generic.** A broad catch-all advisor whose material is already carried by the
  specific specialists adds nothing — drop it and keep the specifics. (If instead the material is thin
  and only the broad one has substance, keep the broad one and drop the empty specifics.)
- **Aim small.** The right number is the count of subjects the user would ASK about separately —
  typically a handful. If you can't say in one line why two specialists must stay separate, they are
  one.
