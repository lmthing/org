# Attempt ledger — 10-family-recipes

Owned subsystem (this lane): `libs/core/system-spaces/user-thing/knowledge/**` and
`libs/core/system-spaces/user-thing/tasklists/organize_material/**`. APPBUILDER (page/plan/app build)
bugs → report to main, do NOT edit. Any other subsystem → report, don't edit.

Scenario: 25 steps. Greek+Italian cuisine specialists + a household-logistics space (weekly-shop
tasklist + cron + internal low-stock event pipeline) + a live app (recipes/meal_plan/shopping_list/
substitutions). Six fixtures all attached on step 1 (+ dish-photo re-sent on step 4).

## Runs
- R1 · run 1 (port 32895) · launched, polling from step 01.

## Notes / observations
- knowledge/organizing/split/recipes.md already exists: "recipe collection is mostly DATA; make a
  specialist only for a real ADVICE subject (a cuisine, dietary approach, technique)". Does NOT
  currently say anything about a recurring meal-planning / weekly-shop logistics specialist that owns a
  scheduled tasklist — step 2 expects a household-logistics space with a cron weekly-shop tasklist +
  internal event pipeline. Watch step 2/7 for whether that space gets created.

## Ledger lines
- R1 · step 1 · PASS · photos→vision, docs→files/dispatch, audio transcribed sync (audio-only tokens
  in reply, no audio delegate), all fixture facts cited, build offer present, 0 errors/asks.
- R1 · step 2 · FAIL (multi-cause, mostly NOT mine) · run 1 · reported to main, awaiting sequencing.
  PASSED within step 2: 2 cuisine spaces (Greek+Italian, user never named), Σπανακόπιτα recipes row
  carries audio-only tokens (μαστίχα/τσίπουρο/Δέσποινα/"αυγό στη γέμιση"/190), 7 tables authored w/
  real rows, app reaches built:true by step 3 (2 recipe pages).
  FAILED: (a) NO household-logistics space — enumerate resolved only ['Ελληνική κουζίνα','Ιταλική
  κουζίνα']; my knowledge/organizing/split/recipes.md says "Never... a 'meals' one" → steered enumerate
  away from a logistics scope. Even if named, build_specialist→architect#synthesize_and_run builds an
  ADVICE specialist, NOT a space w/ weekly-shop tasklist+cron+internal event pipeline (architect gap,
  not mine). (b) NO system-research delegate / NO substitutions table (research/appbuilder lanes).
  (c) NO low-stock event pipeline (depends on (a)). (d) app built:true but only recipe pages, no
  meal_plan/shopping pages, no substitutions table (appbuilder lane — main already on the large-app
  collapse; step 2 snapshot caught built:false mid-build + "session evicted mid-turn" at 474K tokens on
  build_live_project). (e) attachmentIds typecheck_errors (recovered) inside architect
  synthesize_and_run — host-context drift: 04-build_specialist (mine) passes attachmentIds in context,
  architect doesn't inject it into scope (architect lane; my task is the caller).
  ASSESSMENT: no fix I can land ALONE in organize_material/** + knowledge/** turns step 2 green — the
  household-logistics operational-space build is an architect capability I don't own. Coordination
  needed. My candidate piece (domain-neutral): recognize a recurring operational/logistics need as its
  own scope, distinct from advice specialists — but useless until architect can build operational spaces.
