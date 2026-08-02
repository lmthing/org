---
id: checkpoint_endpoints
dependsOn: [smoke_endpoints, check_acceptance]
checkpoint: true
---

(checkpoint barrier — every endpoint has landed, been invoked (`smoke_endpoints`) and checked against
seeded data (`check_acceptance`); a resumed run after a crash here skips re-authoring the whole API
surface and continues straight to view-component/automation/shell/view authoring)
