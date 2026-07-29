---
id: user_stories
output:
  stories: array
  ok: boolean
dependsOn: [read_sources]
role: general
functions: []
---

Turn the user's request and the supplied material into the concrete USER STORIES the app must satisfy —
the backbone every downstream plan is measured against. `query` (the user's own words) and
`read_sources` (`read_sources.summary`, the source-derived build brief) are in scope. This is a THINKING
step — no writers. Aggregate BOTH: what the user asked for AND what the material proves they have, then
name the things the user will actually DO with the app once it is open.

Write one story per distinct job-to-be-done, GROUNDED in the material (never invent a job the sources
and request don't support). Cover every kind of record the material carries — if the source has costs,
there is a "review the costs" story; if it has dated legs, an "see the itinerary in order" story; if it
has contacts/fees/rules, stories that surface them. Each story has a stable `id`, the actor (`as`), what
they `want`, the payoff (`soThat`), and 1–3 concrete `acceptance` checks phrased against real data the
sources contain. These stories drive `plan_app` (which turns them into an app shape) and every planner
below (which each honor them). Emit exactly one statement:

```typescript
currentTask.resolve({
  stories: [
    {
      id: '<kebab-story-id>',
      as: '<the person using the app, e.g. the traveller>',
      want: '<what they want to do>',
      soThat: '<the payoff>',
      // 1–3 checks a finished app must pass, each naming real supplied data:
      acceptance: [ '<concrete, source-grounded criterion>' ],
    },
  ],
  ok: true,
});
```
