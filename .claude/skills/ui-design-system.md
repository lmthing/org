---
name: ui-design-system
description: Load when working on the cross-platform component vocabulary (catalog), the display/form renderers, the ink-compatibility layer, or theming.
---

# Skill: UI Design System (terminal + web)

A single cross-platform component vocabulary so spaces render identically in the terminal and the browser.

## Catalog

`packages/core/src/ui/catalog.ts` (browser-safe, exported as `@lmthing/core/ui`): ~30 **display** components (Heading, Stack, Row, Columns, Card, Callout, Table, KeyValue, List, ProgressBar, Spinner, StatCard, Timeline, Badge, Divider, CodeBlock…) and ~33 **form** components (Form, Field, TextField, NumberField, Select, MultiSelect, RadioGroup, Checkbox, Switch, Slider, DatePicker, Rating, OtpInput, ConfirmButtons…). Each entry documents its prop contract; `catalogDts()` turns the catalog into ambient typed JSX globals appended to `LIBRARY_DTS`, and `CATALOG_NAMES` are injected as VM stubs (in `session.injectJSXRuntime`, `delegate.ts`, and `fork.ts`) so the model can write `<Stack/>`/`<Select/>` directly in sessions, delegates, AND forks. Type names are matched **case-insensitively** by the renderers.

## Two display renderers, one vocabulary

- `packages/cli/src/render/ink-renderer.tsx` `renderDescriptor` (→ Ink)
- `packages/ui/src/components/render-descriptor.tsx` `renderDescriptor` (→ themed HTML)

Both implement the display catalog. `display(<Stack>…)` works in both.

## Forms, one model

`ask(<Form>…fields…</Form>)` resolves to an object keyed by field `name`; a bare control (`ask(<Select .../>)`) resolves to the single value.

- Web → `components/forms/CatalogForm.tsx`
- Terminal → `packages/cli/src/render/ink-form.tsx` (interactive, sequential field stepping via `useInput`, wired into `InkRenderHost.ask` in human mode).

Both share flatten/coerce logic in `packages/core/src/ui/form.ts` (`flattenForm`/`coerceValue`/`defaultFor`/`isFormDescriptor`).

## Ink-compatibility layer for web

`packages/ui/src/compat/` (`@lmthing/agent-ui/compat`): web React mirrors of `ink`/`ink-text-input`/`ink-select-input` (Box, Text, Spacer, Newline, Static, Transform, useInput, TextInput, SelectInput, MultiSelect, ConfirmInput) that map Ink props to themed CSS. `serve.ts` aliases bare `ink*` imports here, so a single Ink-flavored component source runs in the browser unchanged.

## Theming

`packages/ui/src/theme/theme.ts` + `app/styles.css`: tokens defined per `[data-theme]` (dark default + light), exposed as both Tailwind `--color-lm-*` and plain `--lm-*` vars; runtime-switchable (DevTools header toggle, persisted). A space's optional `theme.json` is injected by `serve.ts` as `:root` overrides.

## Notes

- `display()` output and the VARIABLES preview are unaffected — only the rendered component set grew.
- The catalog is browser-safe (`@lmthing/core/ui`); **never import the full `@lmthing/core` barrel from web code** (it pulls Node built-ins into the esbuild browser bundle).
