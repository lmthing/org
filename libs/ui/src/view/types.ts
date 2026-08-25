/**
 * The view-spec contract, as the RENDERER sees it.
 *
 * ## Why this is a copy and not an import
 *
 * The pinned contract lives in `sdk/org/libs/cli/src/app/view-spec/schema.ts` — and
 * `@lmthing/cli` **depends on** `@lmthing/ui`, so importing it back here would be a
 * package cycle. It is also a node package (ajv, `fs`) that must never reach the Metro
 * graph, and the mobile app imports this renderer directly.
 *
 * So this module mirrors the contract's TypeScript half, structurally. TypeScript is
 * structural, so a `ViewSpec` produced against `schema.ts` assigns to {@link ViewSpec}
 * here with no adapter — which is exactly what the prebuilt AppHost and the mobile agent's
 * native screen rely on.
 *
 * **Rules for keeping the two honest**
 *  - `schema.ts` is the source of truth. A change there is a change here, in the same
 *    commit. The vocabularies below are the ones the renderer must exhaustively handle,
 *    so a new element or section kind added upstream and not added here is a renderer
 *    gap — `elements.tsx` and `sections/index.tsx` both end in a `never`-typed default
 *    that makes it a `pnpm typecheck` failure rather than a blank on a phone.
 *  - Everything here is SHAPE ONLY, and deliberately permissive: the renderer never
 *    validates. A spec reaching the renderer has already passed `validateViewSpecShape`
 *    plus `validate.ts`'s name/binding cross-checks at save time. The renderer's job on
 *    bad data is to render a default, never to throw.
 */

// ── the closed vocabularies ──────────────────────────────────────────────────

/** The 12 section kinds. The union is FULL — a thirteenth is a plan change, not a patch. */
export const SECTION_KINDS = [
  'list',
  'detail',
  'create',
  'stats',
  'markdown',
  'chat',
  'toolbar',
  'timeline',
  'board',
  'calendar',
  'chart',
  'outlet',
] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

/** The 32 elements. */
export const ELEMENT_KINDS = [
  'row',
  'col',
  'grid',
  'spacer',
  'divider',
  'surface',
  'heading',
  'text',
  'caption',
  'markdown',
  'code',
  'quote',
  'badge',
  'statcard',
  'meter',
  'keyvalue',
  'table',
  'timeline',
  'rating',
  'chart',
  'calendar',
  'steps',
  'image',
  'icon',
  'avatar',
  'banner',
  'empty',
  'button',
  'link',
  'field',
  'tabs',
  'accordion',
] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]

/** Value formatting — a modifier on any bound value, never an element. */
export const FORMATS = [
  'currency',
  'date',
  'datetime',
  'time',
  'relative-time',
  'number',
  'percent',
  'humanize',
] as const
export type Format = (typeof FORMATS)[number]

/** Semantic tone. Never a colour — the renderer maps each to a design token. */
export const TONES = ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'auto'] as const
export type Tone = (typeof TONES)[number]

/**
 * The named icon set. Finite BY DESIGN: a spec names an icon, the renderer owns the
 * drawing (SVG primitives — lucide is web-only, so a native fork cannot use it).
 *
 * 32 names — the same tuple `schema.ts` pins. The tuple is the contract; count from it.
 */
export const ICON_NAMES = [
  'home',
  'search',
  'plus',
  'edit',
  'trash',
  'check',
  'close',
  'chevron-right',
  'chevron-down',
  'arrow-left',
  'filter',
  'more',
  'refresh',
  'calendar',
  'clock',
  'user',
  'users',
  'tag',
  'file',
  'map-pin',
  'alert',
  'info',
  'star',
  'bell',
  'chart',
  'list',
  'link',
  'external-link',
  'download',
  'upload',
  'mail',
  'settings',
] as const
export type IconName = (typeof ICON_NAMES)[number]

/** How a `list` section presents its rows. Absent ⇒ the renderer picks per target. */
export const LIST_LAYOUTS = ['cards', 'rows', 'table', 'grid'] as const
export type ListLayout = (typeof LIST_LAYOUTS)[number]

/** Page archetypes — predicted from the section composition when `layout` is absent. */
export const PAGE_ARCHETYPES = ['dashboard', 'list', 'detail', 'master-detail', 'form', 'stack'] as const
export type PageArchetype = (typeof PAGE_ARCHETYPES)[number]

/** Where the shell's navigation sits. `auto` (the default) is target-predicted. */
export const SHELL_PLACEMENTS = ['auto', 'tabs', 'sidebar', 'topbar'] as const
export type ShellPlacement = (typeof SHELL_PLACEMENTS)[number]

/**
 * The shell is derived from the route list ONLY up to this many top-level static routes.
 * Above it, the model declares {@link ShellSpec.groups} — deriving anyway produced an
 * unusable 13–21-item bottom bar in 4 of 5 measured apps.
 */
export const SHELL_DERIVE_MAX_ROUTES = 5

/** The interactive control kinds of the `field` element. */
export const FIELD_KINDS = [
  'toggle',
  'rating',
  'select',
  'stepper',
  'text',
  'date',
  'number',
  'textarea',
  'multiselect',
  'slider',
] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

// ── scalars ──────────────────────────────────────────────────────────────────

/** A binding PATH (`$.field`). Never an expression. */
export type Binding = string
/** A literal string OR a binding. */
export type Value = string
/**
 * An **argument** — a constant or a binding. The value type of every argument map
 * (`input`, `mutate.input`, `navigate.params`, `link.params`, `prefill.input`).
 *
 * Wave-2 amendment: these were paths only, which made `{ meal: 'dinner' }` and
 * `{ withinDays: 7 }` illegal and left one endpoint called with three different constants
 * inexpressible. A string argument is still a {@link Value} — a binding when it starts with
 * a root, a literal otherwise — so the renderer's job is unchanged: walk a path, or copy a
 * constant. See `bind.ts#resolveInputs`.
 */
export type Arg = Value | number | boolean
/** An authoring route (`recipes/[id]`). */
export type Route = string
/** A component prop type (`Recipe`, `Recipe[]`, `string`). */
export type TypeRef = string

export type Justify = 'start' | 'center' | 'end' | 'between'
export type Align = 'start' | 'center' | 'end' | 'stretch'

/** The formatting modifier, mixed into every prop group carrying a bound value. */
export interface Formatted {
  format?: Format
  /** Names the row field holding the ISO currency code (the two multi-currency apps). */
  currencyField?: Binding
}

/**
 * The tone modifier. `toneMap` is the load-bearing part — a lookup table, NOT a
 * predicate, which is how a third of the corpus gets conditional colour without the
 * language gaining conditionals.
 */
export interface Toned {
  tone?: Tone
  toneMap?: Record<string, Tone>
  /** The value to key `toneMap` on, when it is not the element's own bound value. */
  toneOf?: Binding
}

/**
 * Poll-while-pending — a named declarative policy over a finite value set.
 * For a collection section, `while.field` is evaluated per row and matches if ANY row
 * matches. Absent `while`, the section polls unconditionally.
 */
export interface Poll {
  everyMs: number
  while?: { field: Binding; in: (string | number | boolean)[] }
}

// ── actions ──────────────────────────────────────────────────────────────────

/** Call a mutation endpoint by name. */
export interface MutateAction {
  mutate: string
  input?: Record<string, Arg>
  /** Bulk commit: send the enclosing list's current multi-selection. */
  over?: 'selection'
  /** Which Input property receives the renderer-supplied value. */
  arg?: string
  /** Confirmation copy. Present ⇒ the renderer confirms before firing. */
  confirm?: string
  invalidates?: string[]
  /** Where to go once it succeeds. The Output is reachable as `$result.*`. */
  onSuccess?: Action
}

export interface NavigateAction {
  navigate: Route
  params?: Record<string, Arg>
}
export interface DownloadAction {
  download: string
  input?: Record<string, Arg>
  filename?: Value
}
export interface PrintAction {
  print: true
}
export interface CopyAction {
  copy: Value
}

/** What a button / row / toolbar entry DOES. Names only — no URLs, no handlers. */
export type Action = MutateAction | NavigateAction | DownloadAction | PrintAction | CopyAction

/** A labelled action — a toolbar entry, a detail-header action, a bulk action. */
export interface ActionItem {
  label: Value
  action?: Action
  /** Section ids to show/hide. An item must act, reveal, or both. */
  reveals?: string[]
  icon?: IconName
  tone?: Tone
  variant?: 'primary' | 'secondary' | 'ghost'
}

// ── elements ─────────────────────────────────────────────────────────────────

export interface RowEl {
  el: 'row'
  children?: Slot[]
  gap?: number
  justify?: Justify
  align?: Align
  wrap?: boolean
  /** Horizontal scrolling. Native correctness: Yoga has no overflow scrolling. */
  scroll?: 'x'
}
export interface ColEl {
  el: 'col'
  children?: Slot[]
  gap?: number
  align?: Align
}
export interface GridEl {
  el: 'grid'
  children?: Slot[]
  columns?: number
  gap?: number
  scroll?: 'x'
}
export interface SpacerEl {
  el: 'spacer'
}
export interface DividerEl {
  el: 'divider'
  label?: Value
}
export interface SurfaceEl extends Toned {
  el: 'surface'
  children?: Slot[]
  title?: Value
  action?: Action
}
export interface HeadingEl {
  el: 'heading'
  text: Value
  level?: 1 | 2 | 3 | 4
}
export interface TextEl extends Formatted, Toned {
  el: 'text'
  text: Value
  bold?: boolean
  dim?: boolean
  italic?: boolean
  strike?: boolean
  maxLines?: number
}
export interface CaptionEl extends Formatted, Toned {
  el: 'caption'
  text: Value
  maxLines?: number
}
export interface MarkdownEl {
  el: 'markdown'
  text: Value
}
export interface BadgeEl extends Toned {
  el: 'badge'
  text: Value
  shape?: 'badge' | 'pill' | 'tag'
  icon?: IconName
}
export interface StatcardEl extends Formatted, Toned {
  el: 'statcard'
  label: Value
  value: Value
  delta?: Value
  icon?: IconName
  action?: Action
}
export interface MeterEl extends Toned {
  el: 'meter'
  value: Value
  max?: Value | number
  label?: Value
  variant?: 'bar' | 'ring' | 'segments'
}
export type KeyValuePair = { label: Value; value: Value } & Formatted
export interface KeyValueEl {
  el: 'keyvalue'
  pairs: KeyValuePair[]
  layout?: 'stacked' | 'inline'
}
export type TableColumn = { label: Value; value: Value; align?: 'start' | 'center' | 'end' } & Formatted
export interface TableEl {
  el: 'table'
  rows: Binding
  columns: TableColumn[]
  scroll?: 'x'
}
export interface TimelineEl extends Formatted {
  el: 'timeline'
  items: Binding
  title: Value
  time?: Value
  detail?: Value
  icon?: IconName
}
export interface RatingEl {
  el: 'rating'
  value: Value
  max?: number
}
export interface ImageEl {
  el: 'image'
  src: Value
  alt?: Value
  fit?: 'contain' | 'cover'
  ratio?: 'square' | 'wide' | 'tall'
}
export interface IconEl {
  el: 'icon'
  name: IconName
  size?: 'sm' | 'md' | 'lg'
  tone?: Tone
}
export interface BannerEl extends Toned {
  el: 'banner'
  text: Value
  title?: Value
  icon?: IconName
}
/**
 * An empty-state OVERRIDE. Every collection has one by default — this exists to say
 * something better, never to author a state that would otherwise be missing.
 */
export interface EmptyState {
  el?: 'empty'
  title?: Value
  /** Spelled `message`, not `text` — the desk check reached for it 8 times out of 8. */
  message?: Value
  icon?: IconName
  action?: ActionItem
}
export interface EmptyEl extends EmptyState {
  el: 'empty'
}
export interface ButtonEl {
  el: 'button'
  label: Value
  action?: Action
  reveals?: string[]
  icon?: IconName
  tone?: Tone
  variant?: 'primary' | 'secondary' | 'ghost'
}
export interface LinkEl {
  el: 'link'
  text: Value
  to?: Route
  params?: Record<string, Arg>
  href?: Value
  external?: boolean
  icon?: IconName
}
/** The inline-editable control — the seam that gives a row's mutation an argument. */
export interface FieldEl {
  el: 'field'
  kind: FieldKind
  value: Binding
  mutation: string
  /** Which Input property receives the new value. Defaults to `value`'s last segment. */
  arg?: string
  input?: Record<string, Arg>
  label?: Value
  placeholder?: Value
  options?: string[] | Binding
  min?: number
  max?: number
  step?: number
  submitLabel?: Value
  invalidates?: string[]
}

/** A monospace block — an id, a snippet, an agent's raw output. */
export interface CodeEl {
  el: 'code'
  text: Value
  language?: string
}
/** A pulled quote. */
export interface QuoteEl {
  el: 'quote'
  text: Value
  cite?: Value
}
/** A plot, drawn from SVG primitives so it exists on a phone too. */
export interface ChartEl extends Formatted, Toned {
  el: 'chart'
  kind: 'bar' | 'line' | 'area' | 'donut'
  data: Binding
  x: Value
  y: Value
  series?: Value
  height?: number
  label?: Value
}
/** A month grid — `timeline`'s date-as-GRID sibling. */
export interface CalendarEl extends Toned {
  el: 'calendar'
  items: Binding
  date: Value
  title: Value
  month?: Value
  action?: Action
}
/** Progress through a KNOWN pipeline. */
export interface StepsEl {
  el: 'steps'
  items: { label: Value; caption?: Value }[]
  current: Value
}
/** A person — `name` is the initials fallback when there is no image. */
export interface AvatarEl {
  el: 'avatar'
  src?: Value
  name?: Value
  size?: 'sm' | 'md' | 'lg'
}
/** In-page switching — `toolbar.reveals` for content rather than sections. */
export interface TabsEl {
  el: 'tabs'
  items: { label: Value; icon?: IconName; children?: Slot[] }[]
  initial?: number
}
/** Collapsible groups. */
export interface AccordionEl {
  el: 'accordion'
  items: { label: Value; caption?: Value; children?: Slot[] }[]
  multiple?: boolean
}

export type ElementNode =
  | RowEl
  | ColEl
  | GridEl
  | SpacerEl
  | DividerEl
  | SurfaceEl
  | HeadingEl
  | TextEl
  | CaptionEl
  | MarkdownEl
  | CodeEl
  | QuoteEl
  | BadgeEl
  | StatcardEl
  | MeterEl
  | KeyValueEl
  | TableEl
  | TimelineEl
  | RatingEl
  | ChartEl
  | CalendarEl
  | StepsEl
  | ImageEl
  | IconEl
  | AvatarEl
  | BannerEl
  | EmptyEl
  | ButtonEl
  | LinkEl
  | FieldEl
  | TabsEl
  | AccordionEl

/** A reference to a named view component — usable anywhere an element node is. */
export interface ComponentRef {
  use: string
  props?: Record<string, Value>
}

/**
 * One slot in a {@link FlatItem}: a value, or that value with its modifiers attached.
 *
 * `suffix` is a Wave-2 modifier: `meta: { value: '$.prepMinutes', suffix: 'min' }` renders
 * "20 min" where a bare binding rendered "20". It lives here, on the ONE shared definition,
 * rather than as a `metaSuffix`/`captionSuffix` key family — which is the whole reason the
 * object form exists.
 */
export type FlatValue = Value | ({ value: Value; suffix?: Value; maxLines?: number } & Formatted & Toned)

/** The flat convenience form for an item slot. CLOSED — an invented key is an error. */
export interface FlatItem {
  title?: FlatValue
  subtitle?: FlatValue
  caption?: FlatValue
  meta?: FlatValue
  value?: FlatValue
  suffix?: FlatValue
  note?: FlatValue
  markdown?: FlatValue
  badge?: FlatValue
  status?: FlatValue
  image?: FlatValue
  icon?: IconName
  badges?: Binding
  keyvalue?: KeyValuePair[]
  action?: Action
  actions?: ActionItem[]
}

/** Anything that can fill a slot. */
export type Slot = ElementNode | ComponentRef | FlatItem

/** A named, parameterised composition of elements — a spec fragment, never React. */
/**
 * A nested LAYOUT — the frame every route under `prefix` renders inside.
 *
 * An ordinary view spec with two extra rules: it lives at `views/<prefix>/_layout.view.json`, and
 * exactly one of its sections is an `outlet`. The whole chain shares one runtime scope, so a
 * child page reads the layout's own fetched data as `$data.<layoutSectionId>.…`.
 */
export interface ViewLayoutSpec {
  prefix: Route
  title?: string
  sections: SectionSpec[]
}

export interface ViewComponentSpec {
  name: string
  props?: Record<string, TypeRef>
  node: Slot
  description?: string
}

// ── sections ─────────────────────────────────────────────────────────────────

export interface SectionBase {
  id?: string
  title?: Value
}

export interface Facet {
  field: Binding
  label?: Value
  options?: string[]
  counts?: boolean
}

export interface SortOption {
  label: Value
  field: Binding
  dir?: 'asc' | 'desc'
}

/** An embedded array as a section's source — `'$.citations'` or `'$data.trip.days'`. */
export type From = Binding

export interface ListSection extends SectionBase {
  kind: 'list'
  query?: string
  from?: From
  input?: Record<string, Arg>
  param?: Binding
  limit?: number
  layout?: ListLayout
  item?: Slot
  facet?: Facet[]
  sort?: SortOption[]
  search?: boolean | { fields?: Binding[]; placeholder?: string }
  rowAction?: Action
  rowActions?: ActionItem[]
  selectable?: boolean
  bulkActions?: ActionItem[]
  poll?: Poll
  empty?: Value | EmptyState
}

export interface DetailSection extends SectionBase {
  kind: 'detail'
  query: string
  param?: Binding
  input?: Record<string, Arg>
  header?: Slot
  fields?: KeyValuePair[]
  body?: Slot
  actions?: ActionItem[]
  poll?: Poll
  empty?: Value | EmptyState
}

/** A form. **There is deliberately no `fields` property** — they derive from the Input schema. */
export interface CreateSection extends SectionBase {
  kind: 'create'
  mutation: string
  /** Values supplied by the page rather than the user — hidden from the form. */
  input?: Record<string, Arg>
  submitLabel?: Value
  invalidates?: string[]
  async?: { note?: Value; refetchAfter?: number }
  prefill?: {
    endpoint: string
    input?: Record<string, Arg>
    from?: Binding
    merge?: 'fill-empty'
  }
  onSuccess?: Action
}

export type StatCard = {
  label: Value
  value: Value
  delta?: Value
  icon?: IconName
  meter?: boolean | { max?: Value | number; variant?: 'bar' | 'ring' | 'segments' }
  action?: Action
} & Formatted &
  Toned

export interface StatsSection extends SectionBase {
  kind: 'stats'
  query: string
  input?: Record<string, Arg>
  cards: StatCard[]
  poll?: Poll
}

export interface MarkdownSection extends SectionBase {
  kind: 'markdown'
  source?: string
  query?: string
  param?: Binding
  input?: Record<string, Arg>
  value?: Binding
  poll?: Poll
}

export interface ChatSection extends SectionBase {
  kind: 'chat'
  agent: string
  space?: string
  greeting?: Value
  height?: 'sm' | 'md' | 'lg' | 'full'
  /** First-run suggested prompts — tappable chips shown while the chat is empty. The newborn chat
   *  page seeds these so a blank project is not a blank box. */
  suggestions?: string[]
}

export interface ToolbarSection extends SectionBase {
  kind: 'toolbar'
  reveals?: string[]
  actions?: ActionItem[]
}

export interface TimelineSection extends SectionBase {
  kind: 'timeline'
  query?: string
  from?: From
  input?: Record<string, Arg>
  param?: Binding
  group?: Binding
  groupFormat?: Format
  limit?: number
  item?: Slot
  itemTime?: Binding
  itemEndTime?: Binding
  itemNote?: Binding
  rowAction?: Action
  rowActions?: ActionItem[]
  poll?: Poll
  empty?: Value | EmptyState
}

/** Rows bucketed into columns by one field — the pipeline surface. */
export interface BoardSection extends SectionBase {
  kind: 'board'
  query?: string
  from?: From
  input?: Record<string, Arg>
  param?: Binding
  group: Binding
  columns?: { value: string; label?: Value; tone?: Tone }[]
  limit?: number
  item?: Slot
  rowAction?: Action
  rowActions?: ActionItem[]
  poll?: Poll
  empty?: Value | EmptyState
}

/** Rows on a month grid. */
export interface CalendarSection extends SectionBase {
  kind: 'calendar'
  query?: string
  from?: From
  input?: Record<string, Arg>
  param?: Binding
  date: Binding
  month?: Binding
  limit?: number
  item?: Slot
  rowAction?: Action
  rowActions?: ActionItem[]
  poll?: Poll
  empty?: Value | EmptyState
}

/** Plots over one endpoint's rows. */
export interface ChartSection extends SectionBase {
  kind: 'chart'
  query?: string
  from?: From
  input?: Record<string, Arg>
  param?: Binding
  charts: ({
    kind: 'bar' | 'line' | 'area' | 'donut'
    x: Value
    y: Value
    series?: Value
    label?: Value
    height?: number
  } & Formatted &
    Toned)[]
  poll?: Poll
  empty?: Value | EmptyState
}

/** Where a child route renders. Layouts only, exactly once. */
export interface OutletSection extends SectionBase {
  kind: 'outlet'
}

export type SectionSpec =
  | ListSection
  | DetailSection
  | CreateSection
  | StatsSection
  | MarkdownSection
  | ChatSection
  | ToolbarSection
  | TimelineSection
  | BoardSection
  | CalendarSection
  | ChartSection
  | OutletSection

// ── page + shell ─────────────────────────────────────────────────────────────

export interface ViewSpec {
  route: Route
  title?: string
  /** Absent ⇒ the renderer PREDICTS the archetype from the section composition. */
  layout?: PageArchetype
  sections: SectionSpec[]
}

/** A live count on a nav destination — declared as a DATA SOURCE, not a free binding. */
export interface NavBadge {
  query: string
  field: Binding
}

export interface NavEntry {
  route: Route
  label?: Value
  icon?: IconName
  badge?: NavBadge
}

/** Several routes behind one destination. */
export interface NavGroup {
  label: Value
  /** The tab's landing page. STATIC — a destination with a `[param]` opens nothing. */
  home: Route
  /**
   * The highlight family. A member MAY be parameterised (`trip/[planId]`): a drill-in is
   * exactly the page its tab should stay lit for. `shell.tsx#activeDestination` matches a
   * member by segment SHAPE, so `trip/[planId]` highlights on the live `trip/p7`.
   */
  routes?: Route[]
  icon?: IconName
  badge?: NavBadge
}

/** Entity-scoped sub-navigation — declared ONCE for a route family. */
export interface SubnavSpec {
  /** The parameterised route prefix this nav belongs to (`trips/[tripId]`). */
  match: Route
  label?: Value
  items?: NavEntry[]
  groups?: { label: Value; items: NavEntry[] }[]
}

export interface ShellSpec {
  brand?: string
  nav?: NavEntry[]
  groups?: NavGroup[]
  subnav?: SubnavSpec[]
  placement?: ShellPlacement
  /** The concierge dock — the `chat` section hoisted to the shell. */
  /**
   * An OVERRIDE of renderer chrome, not a switch: `ViewShell` renders a dock on every page
   * whether or not this key exists. `false` suppresses it.
   */
  assistant?: { agent: string; space?: string; greeting?: Value } | false
}

/** `x-options` — a foreign-key form field's option source, read off the Input schema. */
export interface XOptions {
  query: string
  input?: Record<string, Arg>
  label: Binding
  value: Binding
}

// ── narrowing helpers ────────────────────────────────────────────────────────

/** True when a slot is an element node. */
export function isElementNode(slot: Slot): slot is ElementNode {
  return typeof (slot as ElementNode).el === 'string'
}

/** True when a slot is a component reference. */
export function isComponentRef(slot: Slot): slot is ComponentRef {
  return typeof (slot as ComponentRef).use === 'string'
}

/** True when a slot is the flat item form (neither `el` nor `use`). */
export function isFlatItem(slot: Slot): slot is FlatItem {
  return !isElementNode(slot) && !isComponentRef(slot)
}

/** True when an action is a mutation. */
export function isMutateAction(a: Action): a is MutateAction {
  return typeof (a as MutateAction).mutate === 'string'
}
