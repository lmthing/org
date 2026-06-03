---
id: validate
output:
  ok: boolean
  errors: string
dependsOn: [scaffold]
optional: false
goal: false
---

Validate the scaffolded space before registering it.

Call `validateSpace(dir)` using the dir from the scaffold step.

If validation fails, display the errors and attempt to fix them:
1. Identify which files are broken from the error messages.
2. Use `writeFileRaw` to rewrite the offending file with corrected content.
3. Re-run `validateSpace` to confirm.
4. If still failing after one fix attempt, resolve with `{ ok: false, errors: errors.join('; ') }`.

On success, resolve with `{ ok: true, errors: '' }`.
