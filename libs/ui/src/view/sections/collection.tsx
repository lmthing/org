/**
 * The two collection sections — `list` and its group-aware sibling `timeline`.
 *
 * They share one implementation because they share every fact about where rows come from
 * and what a row does; `timeline` adds grouping, a time label and an untimed tray. That is
 * also why the schema builds both from one `listLike()` — an amendment to sourcing lands
 * on both by construction rather than by two people remembering.
 *
 * Between them they replace the core of ~38 + ~20 catalogue pages.
 *
 * ## The four behaviours that are not obvious
 *
 * **A facet is a QUERY INPUT, not a client filter** (schema S4). Once `limit` exists,
 * filtering the rows you happen to have is simply wrong — the answer is on the server. The
 * facet's Input key is the last segment of its `field` binding, and it works over an
 * array-valued field (`tags: string[]`) because the endpoint does the containment test.
 * The ONE case that filters locally is a `from`-sourced section: there is no request to
 * put the value into.
 *
 * **Sort is client-side**, over the rows already loaded (audit I3 — `FeedToolbar`'s four
 * orderings). It is presentation over a bounded set, not a different query.
 *
 * **Selection is by row key, and bulk actions send it under `arg`.** There is deliberately
 * no `$selection` binding root: a value that is not on a path is NAMED by the mutation
 * (`over: 'selection'` + `arg`), so no binding site looks like it might carry hidden
 * client state.
 *
 * **`poll` evaluates per row and fires if ANY row matches** — `homes/inbox` polls while any
 * capture is `pending`. This suite of apps is built on background agents; without it, 20
 * real surfaces look dead while an agent works.
 */

import * as React from 'react'
import * as Prim from '../../elements/primitives/index'
import type { Facet, ListSection, Slot, SortOption, TimelineSection } from '../types'
import { itemScope, resolveBinding, resolveValue, lastSegment, type Scope } from '../bind'
import { applyFormat, stringify } from '../format'
import { renderSlot } from '../elements'
import { ActionItemButton, ActionRow, useDispatch } from '../actions'
import { useSelection, useViewRuntime, usePublish } from '../runtime'
import { SectionFrame, deriveItem, rowKey, titleFromEndpoint, useSectionSource } from './common'
import { SelectControl, TextControl, ToggleControl } from '../controls'
import { ViewIcon } from '../icons'

type Collection = ListSection | TimelineSection

const isTimeline = (s: Collection): s is TimelineSection => s.kind === 'timeline'

export function CollectionSection({ section, scope }: { section: Collection; scope: Scope }): React.ReactElement {
  const { client } = useViewRuntime()
  const dispatch = useDispatch()
  const selection = useSelection()

  // Facet / search / sort state. All three are the renderer's, never the spec's.
  const [facetValues, setFacetValues] = React.useState<Record<string, string>>({})
  const [search, setSearch] = React.useState('')
  const [sortIndex, setSortIndex] = React.useState(0)

  const list = isTimeline(section) ? undefined : section
  const facets = list?.facet ?? []
  const sorts = list?.sort ?? []

  // A facet is a query input; a `from`-sourced section has no query, so it filters locally.
  const serverFaceted = !!section.query
  const searchKey = searchInputKey(client.endpoint(section.query ?? '')?.inputSchema)

  const extraInput = React.useMemo(() => {
    const out: Record<string, string> = {}
    if (serverFaceted) {
      for (const [key, value] of Object.entries(facetValues)) if (value) out[key] = value
      if (searchKey && search.trim()) out[searchKey] = search.trim()
    }
    return out
  }, [serverFaceted, facetValues, search, searchKey])

  const source = useSectionSource({
    query: section.query,
    from: section.from,
    input: section.input,
    // The facet/search values ride on top of the section's own declared inputs.
    extraInput: extraInput,
    param: section.param,
    limit: section.limit,
    poll: section.poll,
    scope,
    id: section.id,
  })

  const rowsRaw = source.rows
  usePublish(section.id, source.query.data)

  const filtered = React.useMemo(() => {
    let rows = rowsRaw
    if (!serverFaceted) {
      for (const facet of facets) {
        const chosen = facetValues[lastSegment(facet.field)]
        if (chosen) rows = rows.filter((row) => facetMatches(row, facet, chosen))
      }
    }
    if (search.trim() && (!serverFaceted || !searchKey)) {
      const needle = search.trim().toLowerCase()
      const fields = typeof list?.search === 'object' ? (list.search.fields ?? []) : []
      rows = rows.filter((row) => rowMatches(row, needle, fields))
    }
    const sort = sorts[sortIndex]
    if (sort) rows = [...rows].sort(comparator(sort))
    return rows
  }, [rowsRaw, serverFaceted, facets, facetValues, search, searchKey, list, sorts, sortIndex])

  const itemSpec: Slot = section.item ?? deriveItem(filtered[0])
  const title = resolveValue(section.title, scope).value ?? titleFromEndpoint(section.query)

  const controls =
    sorts.length > 0 ? (
      <Prim.Box minWidth={160}>
        <SelectControl
          value={String(sortIndex)}
          options={sorts.map((s, i) => ({
            label: stringify(resolveValue(s.label, scope).value ?? s.label),
            value: String(i),
          }))}
          onChange={(v) => setSortIndex(Number(v))}
          placeholder="Sort"
        />
      </Prim.Box>
    ) : undefined

  return (
    <SectionFrame
      title={title as string | undefined}
      scope={scope}
      source={source}
      skeleton={list?.layout === 'cards' || list?.layout === 'grid' ? 'cards' : 'rows'}
      empty={section.empty}
      emptyDefault={emptyTitleFor(section)}
      isEmpty={filtered.length === 0}
      actions={controls}
    >
      <Prim.Col gap="$3">
        {list?.search ? (
          <TextControl
            value={search}
            onChange={setSearch}
            placeholder={
              (typeof list.search === 'object' ? list.search.placeholder : undefined) ?? 'Search…'
            }
          />
        ) : null}

        {facets.length > 0 ? (
          <FacetBar
            facets={facets}
            rows={rowsRaw}
            values={facetValues}
            onChange={(key, value) => setFacetValues((prev) => ({ ...prev, [key]: value }))}
            scope={scope}
          />
        ) : null}

        {list?.selectable && selection.count > 0 ? (
          <Prim.Row
            gap="$2"
            alignItems="center"
            flexWrap="wrap"
            padding="$2"
            borderRadius="$radius-md"
            backgroundColor="$secondary"
          >
            <Prim.Text fontSize="$sm" color="$foreground">
              {`${selection.count} selected`}
            </Prim.Text>
            {(list.bulkActions ?? []).map((item, i) => (
              <ActionItemButton
                key={i}
                item={item}
                scope={scope}
                extras={{ selection: selection.ids, onDone: () => selection.clear() }}
                variant="primary"
              />
            ))}
          </Prim.Row>
        ) : null}

        {isTimeline(section) ? (
          <TimelineRows section={section} rows={filtered} itemSpec={itemSpec} scope={scope} />
        ) : (
          <ListRows
            section={section}
            rows={filtered}
            itemSpec={itemSpec}
            scope={scope}
            selection={list?.selectable ? selection : undefined}
            onRowPress={(row) => {
              if (section.rowAction) void dispatch(section.rowAction, itemScope(scope, row))
            }}
          />
        )}
      </Prim.Col>
    </SectionFrame>
  )
}

// ── list rows ────────────────────────────────────────────────────────────────

function ListRows({
  section,
  rows,
  itemSpec,
  scope,
  selection,
  onRowPress,
}: {
  section: ListSection
  rows: unknown[]
  itemSpec: Slot
  scope: Scope
  selection?: ReturnType<typeof useSelection>
  onRowPress: (row: unknown) => void
}) {
  const layout = section.layout ?? (rows.length > 0 && typeof rows[0] === 'object' ? 'rows' : 'rows')

  const body = rows.map((row, index) => {
    const key = rowKey(row, index)
    const s = itemScope(scope, row)
    const content = (
      <Prim.Row gap="$2" alignItems="flex-start">
        {selection ? (
          <Prim.Box paddingTop="$1">
            <ToggleControl value={selection.has(key)} onChange={() => selection.toggle(key)} />
          </Prim.Box>
        ) : null}
        <Prim.Col gap="$2" flexGrow={1} flexShrink={1} flexBasis="0%">
          {renderSlot(itemSpec, s)}
          <ActionRow items={section.rowActions} scope={s} />
        </Prim.Col>
        {section.rowAction ? <ViewIcon name="chevron-right" size="sm" tone="neutral" /> : null}
      </Prim.Row>
    )

    const wrapped = section.rowAction ? (
      <Prim.Pressable onClick={() => onRowPress(row)} display="flex" flexDirection="column">
        {content}
      </Prim.Pressable>
    ) : (
      content
    )

    if (layout === 'cards' || layout === 'grid') {
      return (
        <Prim.Col
          key={key}
          padding="$4"
          borderWidth={1}
          borderColor="$border"
          borderRadius="$radius-lg"
          backgroundColor="$card"
          {...(layout === 'grid'
            ? { width: '100%', $sm: { width: '48%' }, $lg: { width: '31.5%' }, flexGrow: 1 }
            : {})}
        >
          {wrapped}
        </Prim.Col>
      )
    }
    return (
      <Prim.Col
        key={key}
        paddingVertical="$3"
        {...(index > 0 ? { borderTopWidth: 1, borderColor: '$border' } : {})}
      >
        {wrapped}
      </Prim.Col>
    )
  })

  if (layout === 'grid') {
    return (
      <Prim.Row flexWrap="wrap" gap="$3" alignItems="stretch">
        {body}
      </Prim.Row>
    )
  }
  return <Prim.Col gap={layout === 'cards' ? '$3' : 0}>{body}</Prim.Col>
}

// ── timeline rows ────────────────────────────────────────────────────────────

/**
 * The 8th section kind — a date-grouped, time-ordered stream.
 *
 * `group` is what earns it a KIND rather than an element: absorbing the grouping here is
 * what keeps a `groupBy` from having to be bolted onto `list`. An entry with a null
 * `itemTime` lands in the group's **untimed tray** (`trips/DayTimeline` splits timed from
 * "anytime" items); conflict and gap annotations are computed Output fields bound through
 * `itemNote`, never client logic.
 */
function TimelineRows({
  section,
  rows,
  itemSpec,
  scope,
}: {
  section: TimelineSection
  rows: unknown[]
  itemSpec: Slot
  scope: Scope
}) {
  const dispatch = useDispatch()

  const groups = React.useMemo(() => {
    if (!section.group) return [{ key: '', label: '', rows }]
    const map = new Map<string, unknown[]>()
    for (const row of rows) {
      const key = stringify(resolveBinding(section.group, itemScope(scope, row)))
      const bucket = map.get(key)
      if (bucket) bucket.push(row)
      else map.set(key, [row])
    }
    return [...map.entries()].map(([key, groupRows]) => ({
      key,
      label: applyFormat(key, section.groupFormat),
      rows: groupRows,
    }))
  }, [rows, section.group, section.groupFormat, scope])

  return (
    <Prim.Col gap="$5">
      {groups.map((group) => {
        const timed = group.rows.filter((row) => hasTime(section, row, scope))
        const untimed = group.rows.filter((row) => !hasTime(section, row, scope))
        return (
          <Prim.Col key={group.key} gap="$2">
            {group.label ? (
              <Prim.Text fontSize="$sm" fontWeight="$semibold" color="$muted-foreground">
                {group.label}
              </Prim.Text>
            ) : null}
            <Prim.Col gap="$2" borderLeftWidth={1} borderColor="$border" paddingLeft="$3">
              {timed.map((row, index) => (
                <TimelineEntry key={rowKey(row, index)} section={section} row={row} itemSpec={itemSpec} scope={scope} dispatch={dispatch} />
              ))}
            </Prim.Col>
            {untimed.length > 0 ? (
              <Prim.Col gap="$2" paddingLeft="$3">
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  Anytime
                </Prim.Text>
                {untimed.map((row, index) => (
                  <TimelineEntry
                    key={`u-${rowKey(row, index)}`}
                    section={section}
                    row={row}
                    itemSpec={itemSpec}
                    scope={scope}
                    dispatch={dispatch}
                  />
                ))}
              </Prim.Col>
            ) : null}
          </Prim.Col>
        )
      })}
    </Prim.Col>
  )
}

function hasTime(section: TimelineSection, row: unknown, scope: Scope): boolean {
  if (!section.itemTime) return true
  const v = resolveBinding(section.itemTime, itemScope(scope, row))
  return v !== null && v !== undefined && v !== ''
}

function TimelineEntry({
  section,
  row,
  itemSpec,
  scope,
  dispatch,
}: {
  section: TimelineSection
  row: unknown
  itemSpec: Slot
  scope: Scope
  dispatch: ReturnType<typeof useDispatch>
}) {
  const s = itemScope(scope, row)
  const time = section.itemTime ? resolveValue(section.itemTime, s) : { present: false, value: undefined }
  const endTime = section.itemEndTime ? resolveValue(section.itemEndTime, s) : { present: false, value: undefined }
  const note = section.itemNote ? resolveValue(section.itemNote, s) : { present: false, value: undefined }

  const body = (
    <Prim.Row gap="$3" alignItems="flex-start">
      {time.present ? (
        <Prim.Col minWidth={64}>
          <Prim.Text fontSize="$xs" fontWeight="$medium" color="$foreground">
            {applyFormat(time.value, 'time')}
          </Prim.Text>
          {endTime.present ? (
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {applyFormat(endTime.value, 'time')}
            </Prim.Text>
          ) : null}
        </Prim.Col>
      ) : null}
      <Prim.Col gap="$1" flexGrow={1} flexShrink={1} flexBasis="0%">
        {renderSlot(itemSpec, s)}
        {note.present ? (
          <Prim.Text fontSize="$xs" color="$warning">
            {stringify(note.value)}
          </Prim.Text>
        ) : null}
        <ActionRow items={section.rowActions} scope={s} />
      </Prim.Col>
    </Prim.Row>
  )

  if (!section.rowAction) return body
  return (
    <Prim.Pressable onClick={() => void dispatch(section.rowAction, s)} display="flex" flexDirection="column">
      {body}
    </Prim.Pressable>
  )
}

// ── facets ───────────────────────────────────────────────────────────────────

function FacetBar({
  facets,
  rows,
  values,
  onChange,
  scope,
}: {
  facets: Facet[]
  rows: unknown[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  scope: Scope
}) {
  return (
    <Prim.Row gap="$3" flexWrap="wrap" alignItems="flex-end">
      {facets.map((facet) => {
        const key = lastSegment(facet.field)
        const options = facetOptions(facet, rows, scope)
        const label = stringify(resolveValue(facet.label, scope).value ?? humanizeKey(key))
        return (
          <Prim.Col key={key} gap="$1" minWidth={160}>
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {label}
            </Prim.Text>
            <SelectControl
              value={values[key] ?? ''}
              options={[{ label: 'All', value: '' }, ...options]}
              onChange={(v) => onChange(key, v)}
              placeholder="All"
            />
          </Prim.Col>
        )
      })}
    </Prim.Row>
  )
}

function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

/**
 * A facet's option list, with counts when asked (audit I3 — `homes/FeedToolbar` shows a
 * count beside every option).
 *
 * Declared `options` win. Otherwise they are derived from the rows in hand, ARRAY-VALUED
 * fields flattened, which is what makes `tags: string[]` work.
 */
function facetOptions(facet: Facet, rows: unknown[], scope: Scope): { label: string; value: string }[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const v = resolveBinding(facet.field, itemScope(scope, row))
    const list = Array.isArray(v) ? v : [v]
    for (const entry of list) {
      if (entry === null || entry === undefined || entry === '') continue
      const k = stringify(entry)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  const names = facet.options ?? [...counts.keys()].sort()
  return names.map((name) => ({
    value: name,
    label: facet.counts ? `${name} (${counts.get(name) ?? 0})` : name,
  }))
}

function facetMatches(row: unknown, facet: Facet, chosen: string): boolean {
  const v = resolveBinding(facet.field, { self: row })
  if (Array.isArray(v)) return v.some((entry) => stringify(entry) === chosen)
  return stringify(v) === chosen
}

function rowMatches(row: unknown, needle: string, fields: string[]): boolean {
  if (fields.length > 0) {
    return fields.some((field) => stringify(resolveBinding(field, { self: row })).toLowerCase().includes(needle))
  }
  if (!row || typeof row !== 'object') return stringify(row).toLowerCase().includes(needle)
  return Object.values(row as Record<string, unknown>).some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(needle),
  )
}

function comparator(sort: SortOption): (a: unknown, b: unknown) => number {
  const dir = sort.dir === 'desc' ? -1 : 1
  return (a, b) => {
    const av = resolveBinding(sort.field, { self: a })
    const bv = resolveBinding(sort.field, { self: b })
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return stringify(av).localeCompare(stringify(bv)) * dir
  }
}

/** The search-input key an endpoint accepts, if any. */
function searchInputKey(inputSchema: Record<string, unknown> | undefined): string | undefined {
  const properties = (inputSchema?.properties ?? {}) as Record<string, unknown>
  return ['search', 'q', 'query', 'term'].find((key) => key in properties)
}

function emptyTitleFor(section: Collection): string {
  const noun = titleFromEndpoint(section.query)
  return noun ? `No ${noun.toLowerCase()} yet` : 'Nothing here yet'
}
