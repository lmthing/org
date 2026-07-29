/**
 * Layout prediction — the archetype half.
 *
 * The model rarely writes `layout`; the renderer predicts it from the section
 * composition. How often the model has to set it explicitly is the plan's
 * **layout-override rate** ratchet metric: low means these rules are right, rising means
 * the heuristics need work — not that the model needs more rope.
 *
 * ## Three hard rules, each from a measured layout
 *
 * **(a) An archetype NEVER reorders sections.** Section order is authored — it is the
 * array order. The tempting "dashboard ⇒ stats strip on top" rule would bury
 * `kitchen/index`'s hero card, the one thing that page exists to show. Archetypes govern
 * container width, grid columns and responsive collapse ONLY.
 *
 * **(b) `create` + `list` on the same entity ⇒ a list page with the create as a
 * collapsible header form.** T0's commonest uncovered shape — 5 of 10 desk-checked pages —
 * and `kitchen/recipes` hand-builds exactly it. Rendering the form expanded above a list
 * pushes the list below the fold on a phone for a form most visits never use.
 *
 * **(c) `master-detail` was exercised by ZERO of the ten measured pages.** It stays in the
 * union because the shape is real, but v1 deliberately does not sink time into split-pane
 * logic: it renders as a detail page. When a real page needs it, that is a bucket-1
 * promotion with evidence attached, which is the whole point of the ratchet.
 *
 * ## Where the responsiveness lives
 *
 * Inside the archetype, via the Tamagui media breakpoints already aligned to Tailwind's
 * (`$sm` = 640px, `$lg` = 1024px). **The model never writes a breakpoint** — that is the
 * schema's position and this module is where it is kept true.
 */

import type { PageArchetype, SectionSpec, ViewSpec } from './types'

/** What the renderer decided, and why — the `why` is what a ratchet report reads. */
export interface ArchetypeDecision {
  archetype: PageArchetype
  /** True when the spec set `layout` itself. This is the layout-override-rate numerator. */
  authored: boolean
  /**
   * The `create` section index to render as a collapsible header form, when rule (b)
   * fired. `-1` when it did not.
   */
  headerCreateIndex: number
  reason: string
}

/** Max content width per archetype. A form at 1440px is a line of inputs a metre wide. */
export const ARCHETYPE_WIDTH: Record<PageArchetype, number> = {
  dashboard: 1200,
  list: 960,
  detail: 880,
  'master-detail': 1200,
  form: 620,
  stack: 880,
}

const collectionKinds = new Set(['list', 'timeline'])

/**
 * Strip a leading verb off an endpoint name and normalise, so `addRecipe` and
 * `listRecipes` can be recognised as the same entity.
 *
 * Deliberately crude. It only ever decides whether a create form starts collapsed, so a
 * false negative costs an expanded form and a false positive costs a collapsed one —
 * neither breaks a page, and both are visible to the visual gate.
 */
export function entityOf(name: string | undefined): string {
  if (!name) return ''
  const stripped = name.replace(
    /^(list|get|fetch|all|find|search|add|create|new|save|post|put|update|patch|upsert|import|delete|remove)/i,
    '',
  )
  return stripped.toLowerCase().replace(/(ies)$/, 'y').replace(/s$/, '')
}

/** Do a create and a collection concern the same entity? */
export function sameEntity(create: SectionSpec, collection: SectionSpec): boolean {
  if (create.kind !== 'create') return false
  if (!collectionKinds.has(collection.kind)) return false
  const query = (collection as { query?: string }).query
  // The strongest signal is declared, not guessed: the create says it invalidates the
  // list's query, which is the model stating the relationship outright.
  if (query && (create.invalidates ?? []).includes(query)) return true
  return entityOf(create.mutation) !== '' && entityOf(create.mutation) === entityOf(query)
}

/**
 * Predict the page archetype from its section composition.
 *
 * The order of the tests is the specificity order: the more particular shapes are checked
 * before the general ones, and `stack` is the explicit fallback that turns T0's three
 * fall-throughs into three hits at zero cost.
 */
export function predictArchetype(spec: ViewSpec): ArchetypeDecision {
  const sections = spec.sections ?? []
  const kinds = sections.map((s) => s.kind)
  const count = (kind: string) => kinds.filter((k) => k === kind).length
  const collections = kinds.filter((k) => collectionKinds.has(k)).length

  // Rule (b) — a create paired with a collection over the same entity.
  let headerCreateIndex = -1
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].kind !== 'create') continue
    if (sections.some((other) => sameEntity(sections[i], other))) {
      headerCreateIndex = i
      break
    }
  }

  if (spec.layout) {
    return {
      archetype: spec.layout,
      authored: true,
      headerCreateIndex,
      reason: 'authored',
    }
  }

  const decide = (archetype: PageArchetype, reason: string): ArchetypeDecision => ({
    archetype,
    authored: false,
    headerCreateIndex,
    reason,
  })

  if (count('stats') > 0 && collections >= 2) return decide('dashboard', 'stats + several collections')
  if (count('detail') > 0 && collections >= 1) {
    // Rule (c): the shape that WOULD be master-detail is recognised and then deliberately
    // rendered as a detail page. Recording it here is what lets a later promotion be
    // evidence-driven rather than a rewrite.
    return decide('detail', 'detail + related collections')
  }
  if (count('detail') > 0) return decide('detail', 'a detail record')
  if (headerCreateIndex >= 0 && collections >= 1) return decide('list', 'create + collection on one entity')
  if (collections >= 1 && count('create') === 0) return decide('list', 'a collection page')
  if (count('create') > 0 && collections === 0 && count('stats') === 0) return decide('form', 'create only')
  if (count('stats') > 0 && collections >= 1) return decide('dashboard', 'stats + a collection')
  return decide('stack', 'no recognised composition — the explicit fallback')
}

/**
 * Section ids that are the TARGET of some `reveals` on this page, and therefore start
 * hidden.
 *
 * Computed once per page rather than per section, because a section cannot know whether
 * anything reveals it — and a section that nothing reveals must never start hidden.
 */
export function revealTargetsOf(spec: ViewSpec): Set<string> {
  const out = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) walk(v)
      return
    }
    if (!value || typeof value !== 'object') return
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.reveals)) for (const id of obj.reveals) if (typeof id === 'string') out.add(id)
    for (const v of Object.values(obj)) walk(v)
  }
  walk(spec.sections ?? [])
  return out
}

/**
 * Whether a section should be rendered as a full-width block or as a grid cell, per
 * archetype.
 *
 * The dashboard is the only archetype that grids, and only over its COLLECTIONS: a stats
 * strip already wraps its own tiles, a markdown block reads badly at half width, and a
 * chat dock has a fixed height. Every other archetype is a vertical stack, which on a
 * phone is what all of them are anyway.
 */
export function isGridCell(archetype: PageArchetype, section: SectionSpec): boolean {
  if (archetype !== 'dashboard') return false
  return collectionKinds.has(section.kind)
}
