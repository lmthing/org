---
id: checkpoint_tables
dependsOn: [reconcile_tables]
checkpoint: true
---

(checkpoint barrier — every table has landed and been reconciled against disk; a resumed run after a
crash here skips straight to endpoint authoring instead of re-planning and re-seeding every table)
