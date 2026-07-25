# chat/app/styles.css overrides the design system's fonts app-wide

**Symptom.** `--font-sans` resolves to `-apple-system, "Segoe UI", Roboto, system-ui, sans-serif`
throughout the app, not to the value generated from `tokens.json`
(`TypeMates Cera Round Pro Bold, system-ui, sans-serif`). Confirmed by grepping the shipped bundle:

```
$ grep -o '\-\-font-sans:[^;}]*' apps/web/dist/assets/*.css
--font-sans:-apple-system, "Segoe UI", Roboto, system-ui, sans-serif
```

**Attribution.** `libs/ui/src/chat/app/styles.css` declares its own `--font-sans`/`--font-display`/
`--font-mono` (it was an `@theme` block, now a plain `:root` block after phase 4 of
`docs/tamagui-final-steps.md`). It is loaded after `@lmthing/css/theme.css` and the build emits a
single CSS bundle, so its values win **globally**, not just on `/chat`.

This contradicts the mandatory design-system rule that `libs/css/src/tokens/tokens.json` is the single
source of truth. It has presumably been true since the chat surface was written; nothing detected it
because both files "look" authoritative and CSS never errors on a redefinition.

The radius values in the same block are equivalent to the generated ones (2px = 0.125rem,
6px = 0.375rem, 8px = 0.5rem, 12px = 0.75rem), so only the three font families actually diverge.

**Why it was not fixed in phase 4.** Deleting the override changes the font on every surface. Phase 4
is a CSS *deletion* whose review artefact is a P0 computed-style delta; folding an app-wide font change
into it would make that delta unreviewable. The override was therefore preserved deliberately, with a
comment at the site.

**Proposed fix.** Decide which family is intended. If `tokens.json` is right (it is the documented
source of truth), delete the three font declarations from `chat/app/styles.css` and re-capture the P0
baseline — the delta should be `font-family` **only**, on every fixture. If the chat values are right,
move them into `tokens.json` so one file owns them.

**Verify:** `grep -o '\-\-font-sans:[^;}]*' apps/web/dist/assets/*.css` returns exactly one value, and
it matches `tokens.manifest.json`.
