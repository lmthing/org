/**
 * `ViewThemeProvider` — AppHost's name for `UiThemeProvider`.
 *
 * **Why this exists (found by the T1 golden-app migration, not by a test).** The renderer is
 * built on `Prim.*`, which are real Tamagui components, and every one of them calls `useTheme()`.
 * Outside a provider that throws `Missing theme.` — so an AppHost that renders a bare
 * `<ViewRenderer/>` produces the page-level error boundary on EVERY route.
 *
 * That need is not specific to the view renderer — every `@lmthing/ui` host has it, as the six
 * standalone SPAs proved by shipping the same error boundary — so the implementation now lives at
 * `../theme/provider` alongside the config it mounts. This alias stays because the NAME is part of
 * the renderer's public contract — used by AppHost, the CLI's ambient DTS shim and its
 * render-smoke gate — not a free-floating export.
 *
 * It is a distinct export rather than something `ViewRenderer` mounts itself because the native
 * host already has a provider and nesting a second one would re-root its theme. AppHost is the one
 * delivery path that owns no root, so it is the one that mounts this.
 */

export { UiThemeProvider as ViewThemeProvider } from '../theme/provider'
