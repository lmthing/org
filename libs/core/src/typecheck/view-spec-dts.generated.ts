export const VIEW_SPEC_TYPES = `/* generated from cli/src/app/view-spec/schema.ts; do not edit */
interface ViewSpec {
  /** Authoring route (\`index\`, \`recipes/[id]\`). Persisted as \`pages/<route>.view.json\`. */
  route: Route;
  title?: string;
  /** Absent ⇒ the renderer PREDICTS the archetype from the section composition. */
  layout?: PageArchetype;
  sections: SectionSpec[];
}

type Route = string;

type PageArchetype = (typeof PAGE_ARCHETYPES)[number];

type SectionSpec =
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
  | OutletSection;

interface ListSection extends SectionBase {
  kind: 'list';
  /**
   * Endpoint name (a GET). Required unless {@link ListSection.from} sources the rows from
   * another section's Output — \`{ kind: 'list', query: 'X' }\` remains the minimum section.
   */
  query?: string;
  /** Source the rows from an embedded array instead of the query's root. See {@link From}. */
  from?: From;
  /** Dependent-query arguments. An unresolved binding disables the section. */
  input?: Record<string, Arg>;
  /**
   * Which record, when the query takes one. Defaults to the route's single \`[param]\`, bound
   * under its own key — so \`recipes/[id]\` defaults to \`$route.id\`. (\`$route\` is the root;
   * \`$params\` was renamed and now hard-fails.)
   */
  param?: Binding;
  limit?: number;
  layout?: ListLayout;
  /** The per-row shape. Absent ⇒ the renderer derives it from the Output schema. */
  item?: Slot;
  /**
   * Faceted filtering. NORMATIVE (T0 S4): a facet maps to a **query input** — the endpoint
   * narrows the rows, so a facet is honest about \`limit\` instead of filtering a page that was
   * already truncated.
   */
  facet?: Facet[];
  /**
   * User-selectable orderings (audit I3). NORMATIVE: sorting is applied **client-side, over the
   * \`limit\`ed page**. Nothing measured demanded server-side ordering, and pushing it down would
   * mean an endpoint input for every sortable column.
   */
  sort?: SortOption[];
  /**
   * Free-text search. NORMATIVE: sent as a **query input** when the endpoint's Input schema
   * declares one of \`search\` / \`q\` / \`query\` / \`term\`; otherwise filtered client-side over
   * \`search.fields\`. Declaring the input is what makes search reach rows beyond \`limit\`, so an
   * endpoint that expects to be searched should declare it.
   */
  search?: boolean | { fields?: Binding[]; placeholder?: string };
  /** What tapping a row does. */
  rowAction?: Action;
  /** Row-level actions rendered on each row. */
  rowActions?: ActionItem[];
  /** Multi-select for a bulk commit (audit I5). */
  selectable?: boolean;
  /** Bulk actions over the selection. Their \`mutate\` carries \`over: 'selection'\`. */
  bulkActions?: ActionItem[];
  /** Refresh while a background job is producing rows (audit I4). */
  poll?: Poll;
  /** Override the default empty state — a sentence, or an element. */
  empty?: Value | EmptyState;
}

interface SectionBase {
  /** Stable id — the handle for \`$data.<id>.…\` and for a \`reveals\` target. */
  id?: string;
  /** Section heading. Optional; a renderer default is derived from the endpoint. */
  title?: Value;
}

type Value = string;

type From = Binding;

type Binding = string;

type Arg = Value | number | boolean;

type ListLayout = (typeof LIST_LAYOUTS)[number];

type Slot = ElementNode | ComponentRef | FlatItem;

type ElementNode =
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
  | AccordionEl;

interface RowEl {
  el: 'row';
  children?: Slot[];
  gap?: number;
  justify?: Justify;
  align?: Align;
  wrap?: boolean;
  /**
   * Horizontal scrolling (audit A4). **Native correctness, not cosmetics**: Yoga has no
   * overflow scrolling, so without this a wide strip is silently clipped on a phone with
   * no gesture to reach the rest. 6 components + 13 files with \`overflow-x-auto\`.
   */
  scroll?: 'x';
}

type Justify = 'start' | 'center' | 'end' | 'between';

type Align = 'start' | 'center' | 'end' | 'stretch';

interface ColEl {
  el: 'col';
  children?: Slot[];
  gap?: number;
  align?: Align;
}

interface GridEl {
  el: 'grid';
  children?: Slot[];
  columns?: number;
  gap?: number;
  /** See {@link RowEl.scroll} — a week grid is unreachable on a phone without it. */
  scroll?: 'x';
}

interface SpacerEl {
  el: 'spacer';
}

interface DividerEl {
  el: 'divider';
  label?: Value;
}

interface SurfaceEl extends Toned {
  el: 'surface';
  children?: Slot[];
  title?: Value;
  /** Present ⇒ tapping the surface fires the action (a tappable card). */
  action?: Action;
}

interface Toned {
  tone?: Tone;
  toneMap?: Record<string, Tone>;
  toneOf?: Binding;
}

type Tone = (typeof TONES)[number];

type Action =
  | MutateAction
  /** Navigate to another page of the same app. */
  | { navigate: Route; params?: Record<string, Arg> }
  /**
   * Save an endpoint's Output to a file (T0 feature #5 — OPML export, \`.ics\` calendar,
   * markdown copy; 3 export user stories across 3 apps). Names an endpoint, never a URL
   * and never a Blob: the client download primitive is the renderer's, the bytes are the
   * endpoint's.
   */
  | { download: string; input?: Record<string, Arg>; filename?: Value }
  /** Print the current view (audit A11 — 7 print/export components across 4 apps). */
  | { print: true }
  /** Copy a bound value to the clipboard (audit A11 — 2 components). */
  | { copy: Value };

interface MutateAction {
  mutate: string;
  input?: Record<string, Arg>;
  /**
   * Bulk commit (audit I5): send the enclosing list's current multi-selection. The
   * renderer supplies it under the Input key named by {@link MutateAction.arg}.
   * Only meaningful inside a \`selectable\` list's \`bulkActions\`.
   */
  over?: 'selection';
  /** Which Input property receives the renderer-supplied value (\`over\`'s selection). */
  arg?: string;
  /** Confirmation copy. Present ⇒ the renderer confirms before firing. */
  confirm?: string;
  /** Endpoint names whose cached results this mutation invalidates. */
  invalidates?: string[];
  /**
   * Where to go once it succeeds (T0 feature #3). Available on ANY mutation — a
   * \`rowAction\`, a \`detail.actions\` entry, a bulk action — because **the post-DELETE half
   * is the harder one**: deleting the record you are currently viewing has to send you
   * somewhere. The mutation's Output is reachable as \`$result.*\`, which is why this needs
   * no route templating:
   * \`onSuccess: { navigate: 'searches/[searchId]/inbox', params: { searchId: '$result.id' } }\`.
   */
  onSuccess?: Action;
}

interface HeadingEl {
  el: 'heading';
  text: Value;
  level?: 1 | 2 | 3 | 4;
}

interface TextEl extends Formatted, Toned {
  el: 'text';
  text: Value;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  /**
   * Strike-through — a done shopping item, a packed bag, a superseded price. Three
   * occurrences in the audit's trees (\`ShoppingRow\`, \`PackingRow\`, \`ListingCard\`), which
   * clears the plan's own "one is bespoke, two is a pattern" bar; and a leaf prop is the
   * cheap kind to carry.
   */
  strike?: boolean;
  /** Clamp to N lines with an ellipsis (audit A8 — demand 12 across 5/5 apps). */
  maxLines?: number;
}

interface Formatted {
  format?: Format;
  currencyField?: Binding;
}

type Format = (typeof FORMATS)[number];

interface CaptionEl extends Formatted, Toned {
  el: 'caption';
  text: Value;
  maxLines?: number;
}

interface MarkdownEl {
  el: 'markdown';
  text: Value;
}

interface CodeEl {
  el: 'code';
  text: Value;
  language?: string;
}

interface QuoteEl {
  el: 'quote';
  text: Value;
  cite?: Value;
}

interface BadgeEl extends Toned {
  el: 'badge';
  text: Value;
  shape?: 'badge' | 'pill' | 'tag';
  icon?: IconName;
}

type IconName = (typeof ICON_NAMES)[number];

interface StatcardEl extends Formatted, Toned {
  el: 'statcard';
  label: Value;
  value: Value;
  delta?: Value;
  icon?: IconName;
  action?: Action;
}

interface MeterEl extends Toned {
  el: 'meter';
  value: Value;
  max?: Value | number;
  label?: Value;
  variant?: 'bar' | 'ring' | 'segments';
}

interface KeyValueEl {
  el: 'keyvalue';
  pairs: ({ label: Value; value: Value } & Formatted)[];
  layout?: 'stacked' | 'inline';
}

interface TableEl {
  el: 'table';
  rows: Binding;
  columns: ({ label: Value; value: Value; align?: 'start' | 'center' | 'end' } & Formatted)[];
  /** See {@link RowEl.scroll} — a wide table is clipped on a phone without it. */
  scroll?: 'x';
}

interface TimelineEl extends Formatted {
  el: 'timeline';
  items: Binding;
  title: Value;
  time?: Value;
  detail?: Value;
  icon?: IconName;
}

interface RatingEl {
  el: 'rating';
  value: Value;
  max?: number;
}

interface ChartEl extends Formatted, Toned {
  el: 'chart';
  kind: 'bar' | 'line' | 'area' | 'donut';
  /** The array to plot. */
  data: Binding;
  /** The category / time axis value, per entry. */
  x: Value;
  /** The numeric value, per entry. */
  y: Value;
  /** Optional grouping key — one line/band per distinct value. */
  series?: Value;
  height?: number;
  /** Axis + legend labels. Absent ⇒ the renderer labels from the bindings' last segments. */
  label?: Value;
}

interface CalendarEl extends Toned {
  el: 'calendar';
  /** The array of dated entries. */
  items: Binding;
  /** Each entry's date. An entry whose date does not resolve is dropped, not guessed. */
  date: Value;
  /** Each entry's label. */
  title: Value;
  /** Which month to show — a bound ISO date or a literal. Absent ⇒ the month of the first entry. */
  month?: Value;
  /** What tapping an entry does. */
  action?: Action;
}

interface StepsEl {
  el: 'steps';
  items: { label: Value; caption?: Value }[];
  /** The current step — an index, or a value matching one of the labels. */
  current: Value;
}

interface ImageEl {
  el: 'image';
  src: Value;
  alt?: Value;
  fit?: 'contain' | 'cover';
  ratio?: 'square' | 'wide' | 'tall';
}

interface IconEl {
  el: 'icon';
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  tone?: Tone;
}

interface AvatarEl {
  el: 'avatar';
  src?: Value;
  name?: Value;
  size?: 'sm' | 'md' | 'lg';
}

interface BannerEl extends Toned {
  el: 'banner';
  text: Value;
  title?: Value;
  icon?: IconName;
}

interface EmptyEl extends EmptyState {
  el: 'empty';
}

interface EmptyState {
  el?: 'empty';
  title?: Value;
  /**
   * The explanatory line under the title.
   *
   * Spelled \`message\`, not \`text\`, because the desk check reached for \`message\` **8 times
   * out of 8** unprompted. For a weak-model interface, measured evidence about what the
   * model actually writes beats internal consistency with \`banner.text\`. One spelling; no
   * alias.
   */
  message?: Value;
  icon?: IconName;
  action?: ActionItem;
}

interface ActionItem {
  label: Value;
  action?: Action;
  reveals?: string[];
  icon?: IconName;
  tone?: Tone;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface ButtonEl {
  el: 'button';
  label: Value;
  action?: Action;
  reveals?: string[];
  icon?: IconName;
  tone?: Tone;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface LinkEl {
  el: 'link';
  text: Value;
  to?: Route;
  params?: Record<string, Arg>;
  href?: Value;
  external?: boolean;
  icon?: IconName;
}

interface FieldEl {
  el: 'field';
  kind: FieldKind;
  /** The field being edited — the control's current state. */
  value: Binding;
  /** The mutation endpoint the change is submitted to. */
  mutation: string;
  /** Which Input property receives the new value. Defaults to \`value\`'s last segment. */
  arg?: string;
  /** The mutation's other arguments, bound from the row/section scope (\`{ id: '$.id' }\`). */
  input?: Record<string, Arg>;
  label?: Value;
  placeholder?: Value;
  /** \`select\` options: a literal list, or a binding to one. Enums also come from the Input schema. */
  options?: string[] | Binding;
  /** \`rating\`/\`stepper\` bounds. */
  min?: number;
  max?: number;
  step?: number;
  /** \`text\`: the submit affordance's copy. */
  submitLabel?: Value;
  invalidates?: string[];
}

type FieldKind = (typeof FIELD_KINDS)[number];

interface TabsEl {
  el: 'tabs';
  items: { label: Value; icon?: IconName; children?: Slot[] }[];
  /** Which tab opens. Defaults to the first. */
  initial?: number;
}

interface AccordionEl {
  el: 'accordion';
  items: { label: Value; caption?: Value; children?: Slot[] }[];
  /** Allow more than one open at a time. Defaults to single-open. */
  multiple?: boolean;
}

interface ComponentRef {
  use: string;
  props?: Record<string, Value>;
}

interface FlatItem {
  title?: FlatValue;
  subtitle?: FlatValue;
  caption?: FlatValue;
  meta?: FlatValue;
  /** The row's headline figure — an amount, a score. Usually right-aligned. */
  value?: FlatValue;
  /** A unit or currency code shown against \`value\` (\`'$.currency'\`). */
  suffix?: FlatValue;
  /** A quieter secondary line — a warning note, an error, a blocked reason. */
  note?: FlatValue;
  /** A markdown body inside the row (a summary an agent wrote). */
  markdown?: FlatValue;
  badge?: FlatValue;
  /** A second, status-shaped badge (\`$.status\`), typically with \`tone: 'auto'\`. */
  status?: FlatValue;
  image?: FlatValue;
  icon?: IconName;
  /** A binding to a string array, rendered as one badge per entry (tags). */
  badges?: Binding;
  /** A compact definition list inside the row. */
  keyvalue?: ({ label: Value; value: Value } & Formatted)[];
  /** What tapping the row does. */
  action?: Action;
  /** Explicit per-row controls. */
  actions?: ActionItem[];
}

type FlatValue =
  | Value
  | ({ value: Value; suffix?: Value; maxLines?: number } & Formatted & Toned);

interface Facet {
  field: Binding;
  label?: Value;
  options?: string[];
  counts?: boolean;
}

interface SortOption {
  label: Value;
  field: Binding;
  dir?: 'asc' | 'desc';
}

interface Poll {
  everyMs: number;
  while?: { field: Binding; in: (string | number | boolean)[] };
}

interface DetailSection extends SectionBase {
  kind: 'detail';
  query: string;
  /** Which record. Defaults to the route's single \`[param]\` (\`$params.id\`). */
  param?: Binding;
  input?: Record<string, Arg>;
  /** The top of the record — a component ref, an element tree, or the flat form. */
  header?: Slot;
  /** The keyvalue body. */
  fields?: ({ label: Value; value: Value } & Formatted)[];
  /** Free-form body below the fields. */
  body?: Slot;
  actions?: ActionItem[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

interface CreateSection extends SectionBase {
  kind: 'create';
  /** Mutation endpoint name (POST/PATCH/PUT/DELETE). */
  mutation: string;
  /** Values supplied by the page rather than the user (a parent id) — hidden from the form. */
  input?: Record<string, Arg>;
  submitLabel?: Value;
  /** Endpoint names whose cached results this mutation invalidates. */
  invalidates?: string[];
  /** The mutation runs in the background (an import): show a note, refetch after N ms. */
  async?: { note?: Value; refetchAfter?: number };
  /** Pre-populate from another endpoint. \`merge: 'fill-empty'\` is the only policy in v1. */
  prefill?: {
    endpoint: string;
    input?: Record<string, Arg>;
    /** Path into the prefill endpoint's Output to read the field map from. */
    from?: Binding;
    merge?: 'fill-empty';
  };
  onSuccess?: Action;
}

interface StatsSection extends SectionBase {
  kind: 'stats';
  query: string;
  input?: Record<string, Arg>;
  cards: ({
    label: Value;
    value: Value;
    delta?: Value;
    icon?: IconName;
    meter?: boolean | { max?: Value | number; variant?: 'bar' | 'ring' | 'segments' };
    action?: Action;
  } & Formatted &
    Toned)[];
  poll?: Poll;
}

interface MarkdownSection extends SectionBase {
  kind: 'markdown';
  /** Literal markdown. Not a {@link Value} — markdown legitimately contains \`\${\`. */
  source?: string;
  query?: string;
  input?: Record<string, Arg>;
  /** Which Output field holds the markdown. */
  value?: Binding;
  /** Refresh while an agent is still writing it (audit I4 — \`blog/ArticleTakes\`). */
  poll?: Poll;
}

interface ChatSection extends SectionBase {
  kind: 'chat';
  /**
   * Agent slug within the project's space — \`pantry-keeper\`, \`sous\`, \`data-modeler\`.
   * Validated by {@link AGENT_NAME_PATTERN} (kebab-case is the codebase's convention);
   * whether the agent EXISTS is \`validate.ts\`'s check, against the real menu.
   */
  agent: string;
  /** Space name, when the agent is not in the project's own space. */
  space?: string;
  greeting?: Value;
  height?: 'sm' | 'md' | 'lg' | 'full';
  /**
   * First-run suggested prompts. Rendered as tappable chips while the transcript is still empty;
   * a tap sends that prompt as the first message. The newborn chat page seeds these so a blank
   * project says what it can do ("Track my expenses", "Plan a trip").
   */
  suggestions?: string[];
}

interface ToolbarSection extends SectionBase {
  kind: 'toolbar';
  /** Section ids this toolbar shows/hides — the declarative replacement for \`useState\`. */
  reveals?: string[];
  actions?: ActionItem[];
}

interface TimelineSection extends SectionBase {
  kind: 'timeline';
  query?: string;
  /** Usually set — the stream is nearly always an embedded array. See {@link From}. */
  from?: From;
  input?: Record<string, Arg>;
  param?: Binding;
  /** The grouping key — a date-ish binding (\`$.day\`). Absent ⇒ one ungrouped stream. */
  group?: Binding;
  /** How to render the group heading. */
  groupFormat?: Format;
  limit?: number;
  /** The per-entry shape. Absent ⇒ derived from the Output schema. */
  item?: Slot;
  /** The entry's time label. Null ⇒ the entry is untimed. */
  itemTime?: Binding;
  itemEndTime?: Binding;
  /** A per-entry annotation (a conflict or gap note computed by the endpoint). */
  itemNote?: Binding;
  rowAction?: Action;
  rowActions?: ActionItem[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

interface BoardSection extends SectionBase {
  kind: 'board';
  query?: string;
  from?: From;
  input?: Record<string, Arg>;
  param?: Binding;
  /** The column key, per row (\`$.status\`). */
  group: Binding;
  /** Explicit column order + labels. Absent ⇒ the distinct values in first-seen order. */
  columns?: { value: string; label?: Value; tone?: Tone }[];
  limit?: number;
  item?: Slot;
  rowAction?: Action;
  rowActions?: ActionItem[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

interface CalendarSection extends SectionBase {
  kind: 'calendar';
  query?: string;
  from?: From;
  input?: Record<string, Arg>;
  param?: Binding;
  /** Each row's date. A row whose date does not resolve is listed as undated, never guessed. */
  date: Binding;
  /** Which month to show. Absent ⇒ the month of the earliest row. */
  month?: Binding;
  limit?: number;
  item?: Slot;
  rowAction?: Action;
  rowActions?: ActionItem[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

interface ChartSection extends SectionBase {
  kind: 'chart';
  query?: string;
  from?: From;
  input?: Record<string, Arg>;
  param?: Binding;
  charts: ({
    kind: 'bar' | 'line' | 'area' | 'donut';
    x: Value;
    y: Value;
    series?: Value;
    label?: Value;
    height?: number;
  } & Formatted &
    Toned)[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

interface OutletSection extends SectionBase {
  kind: 'outlet';
}

interface ViewLayoutSpec {
  /** The route prefix this frame owns (\`trips/[tripId]\`). Its own directory path. */
  prefix: Route;
  title?: string;
  sections: SectionSpec[];
}

interface ViewComponentSpec {
  /** PascalCase. The name a \`{ use: … }\` reference resolves against. */
  name: string;
  /** Declared props, typed against \`@app/types\` row types. Referenced as \`$props.<key>\`. */
  props?: Record<string, TypeRef>;
  /** The element tree. May reference elements and other components (acyclic). */
  node: Slot;
  description?: string;
}

type TypeRef = string;

interface ShellSpec {
  brand?: string;
  /** Flat destinations. Static routes only. */
  nav?: NavEntry[];
  /** Grouped destinations — required above {@link SHELL_DERIVE_MAX_ROUTES} routes. */
  groups?: NavGroup[];
  /** Per-entity sub-navigation, one entry per route family. */
  subnav?: SubnavSpec[];
  placement?: ShellPlacement;
  /**
   * The persistent assistant dock — **an OVERRIDE, not a switch.**
   *
   * The dock is renderer chrome as of v2: every app has one, on every page, resolved by
   * \`ViewShell\` to the project's own \`thing\` agent. An app builder is never asked to author
   * it, which is the only reliable way to stop it being forgotten (4/5 catalogue apps
   * hand-built one; the shipped spec apps that omitted \`assistant:\` had no way to reach an
   * agent at all).
   *
   * Present ⇒ name a different agent, or add a greeting. \`false\` ⇒ suppress it, for the one
   * honest case: a kiosk or embedded surface where a chat box is wrong.
   */
  assistant?: { agent: string; space?: string; greeting?: Value } | false;
}

interface NavEntry {
  route: Route;
  label?: Value;
  icon?: IconName;
  badge?: NavBadge;
}

interface NavBadge {
  /** Endpoint name whose Output carries the count. */
  query: string;
  /** Path to the number (\`$.unread\`). */
  field: Binding;
}

interface NavGroup {
  label: Value;
  /** The tab's landing page. STATIC — a destination with a \`[param]\` opens nothing. */
  home: Route;
  /** The highlight family. Members MAY be parameterised — a drill-in belongs to its tab. */
  routes?: Route[];
  icon?: IconName;
  badge?: NavBadge;
}

interface SubnavSpec {
  /** The parameterised route prefix this nav belongs to (\`trips/[tripId]\`). */
  match: Route;
  label?: Value;
  /** Flat form. */
  items?: NavEntry[];
  /** Grouped form, for the 15-tabs-in-3-groups case. */
  groups?: { label: Value; items: NavEntry[] }[];
}

type ShellPlacement = (typeof SHELL_PLACEMENTS)[number];

declare const PAGE_ARCHETYPES: readonly ['dashboard', 'list', 'detail', 'master-detail', 'form', 'stack'];

declare const LIST_LAYOUTS: readonly ['cards', 'rows', 'table', 'grid'];

declare const TONES: readonly ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'auto'];

declare const FORMATS: readonly ['currency', 'date', 'datetime', 'time', 'relative-time', 'number', 'percent', 'humanize'];

declare const ICON_NAMES: readonly ['home', 'search', 'plus', 'edit', 'trash', 'check', 'close', 'chevron-right', 'chevron-down', 'arrow-left', 'filter', 'more', 'refresh', 'calendar', 'clock', 'user', 'users', 'tag', 'file', 'map-pin', 'alert', 'info', 'star', 'bell', 'chart', 'list', 'link', 'external-link', 'download', 'upload', 'mail', 'settings'];

declare const FIELD_KINDS: readonly ['toggle', 'rating', 'select', 'stepper', 'text', 'date', 'number', 'textarea', 'multiselect', 'slider'];

declare const SHELL_PLACEMENTS: readonly ['auto', 'tabs', 'sidebar', 'topbar'];`;
