---
id: revalidate
output:
  ok: boolean
  errors: string
dependsOn: [rescaffold]
optional: false
goal: false
---

Re-validate the space after re-scaffolding to confirm it is structurally correct.

Call `validateSpace(rescaffold.dir)` and resolve with
`{ ok: result.ok, errors: result.errors.join('; ') }`.

If validation fails, display the errors clearly. The re-register step's condition
will gate on `revalidate.ok`.
