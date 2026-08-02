---
id: checkpoint_ui
dependsOn: [verify]
checkpoint: true
---

(checkpoint barrier — the whole UI (components, automations, shell, views) has landed and the build
gate has run; a resumed run after a crash here skips straight to `fix`/`finalize` instead of
re-authoring every view component and page)
