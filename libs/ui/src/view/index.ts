/**
 * `@lmthing/ui/view` — the shared **ViewRenderer**: a view spec, rendered natively.
 *
 * ```tsx
 * import { ViewRenderer, createViewClient } from '@lmthing/ui/view'
 *
 * const client = createViewClient({ baseUrl, getToken, endpoints })
 * <ViewRenderer spec={spec} components={components} shell={shell} client={client} />
 * ```
 *
 * Two consumers, one renderer:
 *  - **web** — the generated wrapper page (`pages/<route>.tsx`) bundles it, with the spec
 *    inlined and the endpoint manifest injected as today;
 *  - **native** — `apps/mobile` imports it directly and feeds it a spec fetched from
 *    `GET /api/apps/:id/views`. **No WebView on any page, by construction.**
 *
 * Everything below `ViewRenderer` is built on `Prim.*` and the `elements/*` catalogue,
 * with `.native.tsx` forks only where the targets genuinely diverge (exactly one:
 * `hscroll`, because Yoga has no overflow scrolling).
 *
 * The narrow API above is the whole contract. The rest of this barrel is exported for
 * tests, for the CLI's render smoke, and for a host that wants one piece — not because a
 * consumer is expected to assemble a renderer from parts.
 */

// ── the contract ─────────────────────────────────────────────────────────────
export { ViewRenderer, ViewPage, ViewNotFound } from './renderer'
export type { ViewRendererProps, ViewRoute } from './renderer'

export { createViewClient, buildViewRequest, ViewHttpError, actionEndpoints } from './client'
export type {
  ViewClient,
  ViewClientConfig,
  ViewNavigation,
  EndpointManifest,
  EndpointManifestEntry,
} from './client'

// ── the spec types (a structural mirror of the pinned schema) ────────────────
export * from './types'

// ── prediction (exported so a validator can assert on the same rules) ────────
export {
  predictArchetype,
  revealTargetsOf,
  entityOf,
  sameEntity,
  isGridCell,
  ARCHETYPE_WIDTH,
} from './archetype'
export type { ArchetypeDecision } from './archetype'

export {
  ViewShell,
  deriveNav,
  activeDestination,
  subnavFor,
  matchesPrefix,
  paramsFromRoute,
  isStaticRoute,
  topLevel,
} from './shell'
export type { NavDecision, NavDestination, ViewShellProps } from './shell'

// ── the evaluator + modifiers ────────────────────────────────────────────────
export {
  resolveBinding,
  resolveValue,
  resolveOptional,
  resolveArray,
  resolveInputs,
  isBinding,
  itemScope,
  fillRoute,
  routeParams,
  lastSegment,
  pollWhileHolds,
  clientTimezone,
  EMPTY_SCOPE,
} from './bind'
export type { Scope, Resolved } from './bind'

export { applyFormat, formatBound, humanize, relativeTime, stringify, resolveTone, autoTone, toneTokens, TONE_TOKENS } from './format'
export type { ToneTokens } from './format'

// ── runtime + parts ──────────────────────────────────────────────────────────
export { ViewRuntimeProvider, useViewRuntime, useViewQuery, useViewMutation, useSelection, usePublish } from './runtime'
export type { ViewRuntime, QueryState, MutationState, Selection } from './runtime'

export { renderSlot, renderSlots, renderElement, FlatItemView, KeyValueRows, Pill } from './elements'
export { SectionView } from './sections'
export { deriveItem, extractRows, rowKey, useSectionSource, SectionFrame } from './sections/common'
export type { SectionSource } from './sections/common'

export { ViewIcon, StarGlyph, isIconName, ICON_MENU, ICON_SIZES } from './icons'
export { LoadingState, ErrorState, EmptyStateView, PendingNote, InlineNote } from './states'
export { HScroll } from './hscroll'

export { useDispatch, ActionButton, ActionItemButton, ActionRow } from './actions'
export type { Dispatch, DispatchExtras } from './actions'

export {
  SchemaForm,
  FieldControl,
  deriveFields,
  controlFor,
  initialValues,
  isComplete,
  mergeFillEmpty,
} from './form'
export type { DerivedField, JsonSchemaNode, SchemaFormProps } from './form'

export { TextControl, SelectControl, ToggleControl, StepperControl, RatingControl, Labelled } from './controls'
