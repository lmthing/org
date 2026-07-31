---
variable: appBuildingAuthoring
description: The detail behind each freeform authoring job — seeding a table from a source, the table/relation shape, the page + read API that makes data visible, growing an app that already exists without deleting what is there, and updating live rows on a later message. Load the aspect that matches what you are about to write; a FIRST whole-app build needs none of them, because the build_live_project tasklist owns it.
---

# Authoring into a live project — the detail behind each job

Your instructions carry the DECISION (which of the four jobs you are on) and the rules that hold
whatever you write. These aspects carry the rest: the exact call shape, the failure each job has
actually produced in a real user's project, and what to check before you report.

Load the ONE aspect that matches what you are about to author, in the same statement you decide, and
follow it. A first whole-app build loads NOTHING here — it goes straight to the
`build_live_project` tasklist, which owns the whole pipeline.
