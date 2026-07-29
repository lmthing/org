/**
 * The three small sections — `stats`, `markdown` and `toolbar`.
 *
 * They are together because each is a thin arrangement over machinery that already exists
 * elsewhere in the renderer: a stats strip is statcards over one Output, a markdown section
 * is the shared `Markdown` element over a literal or a bound field, and a toolbar is
 * `reveals` plus an action row.
 *
 * `toolbar` is the one worth reading twice: `reveals` is **the declarative replacement for
 * `useState`**. The corpus has 11 disclosure sites and 21 files matching expand/collapse;
 * every one of them is a boolean the spec language has no way to write. Naming section ids
 * instead means the state lives in the renderer, where it can also be a URL concern later,
 * and the spec stays a description.
 */

import * as React from 'react'
import * as Prim from '../../elements/primitives/index'
import { Markdown } from '../../elements/content/markdown'
import type { MarkdownSection, StatsSection, ToolbarSection } from '../types'
import { resolveOptional, resolveValue, type Scope } from '../bind'
import { formatBound, resolveTone, stringify, toneTokens } from '../format'
import { useViewRuntime, usePublish } from '../runtime'
import { ActionItemButton, useDispatch } from '../actions'
import { ViewIcon } from '../icons'
import { LoadingState } from '../states'
import { SectionFrame, useSectionSource } from './common'

// ── stats ────────────────────────────────────────────────────────────────────

/**
 * `stats` — a metrics strip. Replaces 9 dashboards' strips.
 *
 * The cards wrap rather than scroll: a five-card strip on a 390px phone becomes two rows
 * of tiles that are all reachable, where a horizontal strip would hide the last two behind
 * a gesture nobody knows is there. (`scroll: 'x'` exists on `row`/`grid` for the cases
 * where a strip genuinely is a strip.)
 */
export function StatsSectionView({ section, scope }: { section: StatsSection; scope: Scope }): React.ReactElement {
  const dispatch = useDispatch()
  const source = useSectionSource({
    query: section.query,
    input: section.input,
    poll: section.poll,
    scope,
    id: section.id,
  })
  usePublish(section.id, source.query.data)

  const inner: Scope = { ...scope, self: source.record }

  return (
    <SectionFrame title={section.title} scope={scope} source={source} skeleton="stat">
      <Prim.Row gap="$3" flexWrap="wrap" alignItems="stretch">
        {section.cards.map((card, i) => {
          const v = resolveValue(card.value, inner)
          // S1 at the CARD level: a metric the endpoint did not compute leaves no tile
          // reading "—", which is how a dashboard stays honest about what it knows.
          if (!v.present) return null
          const tone = card.tone || card.toneMap ? resolveTone(card, v.value, inner) : undefined
          const delta = resolveValue(card.delta, inner)
          const meterMax =
            typeof card.meter === 'object' && card.meter.max !== undefined
              ? Number(typeof card.meter.max === 'number' ? card.meter.max : resolveOptional(card.meter.max, inner))
              : 100
          const pct = card.meter ? Math.max(0, Math.min(100, (Number(v.value) / (meterMax || 1)) * 100)) : 0

          const tile = (
            <Prim.Col
              gap="$1"
              padding="$4"
              borderWidth={1}
              borderColor="$border"
              borderRadius="$radius-lg"
              backgroundColor="$card"
              minWidth={140}
              flexGrow={1}
              width="100%"
              $sm={{ width: 'auto' }}
            >
              <Prim.Row gap="$1.5" alignItems="center">
                {card.icon ? <ViewIcon name={card.icon} size="sm" tone={tone} /> : null}
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  {stringify(resolveOptional(card.label, inner) ?? card.label)}
                </Prim.Text>
              </Prim.Row>
              <Prim.Text fontSize="$2xl" fontWeight="$semibold" color={tone ? toneTokens(tone).fg : '$card-foreground'}>
                {formatBound(v.value, card, inner)}
              </Prim.Text>
              {delta.present ? (
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  {stringify(delta.value)}
                </Prim.Text>
              ) : null}
              {card.meter ? (
                <Prim.Box height={6} borderRadius="$radius-full" backgroundColor="$muted" overflow="hidden">
                  <Prim.Box height="100%" width={`${pct}%`} backgroundColor={tone ? toneTokens(tone).fg : '$primary'} />
                </Prim.Box>
              ) : null}
            </Prim.Col>
          )

          if (!card.action) return <React.Fragment key={i}>{tile}</React.Fragment>
          return (
            <Prim.Pressable
              key={i}
              onClick={() => void dispatch(card.action, inner)}
              display="flex"
              flexDirection="column"
              flexGrow={1}
            >
              {tile}
            </Prim.Pressable>
          )
        })}
      </Prim.Row>
    </SectionFrame>
  )
}

// ── markdown ─────────────────────────────────────────────────────────────────

/**
 * `markdown` — prose. Literal (`source`) or bound to an endpoint field (`query` + `value`).
 *
 * `source` is NOT a {@link Value}: prose legitimately contains `${` and `{{`, and treating
 * it as a binding expression would reject a perfectly good paragraph. `poll` is here for
 * the same reason it is on a list — `blog/ArticleTakes` refreshes while an agent is still
 * writing the text.
 */
export function MarkdownSectionView({ section, scope }: { section: MarkdownSection; scope: Scope }): React.ReactElement {
  const source = useSectionSource({
    query: section.query,
    input: section.input,
    param: section.param,
    poll: section.poll,
    scope,
    id: section.id,
  })
  usePublish(section.id, source.query.data)

  const bound = section.value ? resolveOptional(section.value, { ...scope, self: source.query.data }) : undefined
  const text = section.source ?? (bound === undefined ? '' : stringify(bound))

  return (
    <SectionFrame
      title={section.title}
      scope={scope}
      source={section.query ? source : undefined}
      skeleton="block"
      isEmpty={text.trim() === ''}
      emptyDefault="Nothing written yet"
    >
      <Markdown source={text} preset="prose" />
    </SectionFrame>
  )
}

// ── toolbar ──────────────────────────────────────────────────────────────────

/**
 * `toolbar` — a header of mode toggles and actions.
 *
 * `reveals` names section ids. Those sections start HIDDEN (the renderer computes the
 * target set once per page) and a press shows all of them; a second press hides them
 * again. All-or-nothing per press, because per-id toggling left a partially-open page in
 * every measured layout.
 */
export function ToolbarSectionView({ section, scope }: { section: ToolbarSection; scope: Scope }): React.ReactElement {
  const { revealed, toggleReveal } = useViewRuntime()
  const open = (section.reveals ?? []).some((id) => revealed.has(id))
  const title = resolveValue(section.title, scope)

  return (
    <Prim.Row gap="$2" alignItems="center" flexWrap="wrap" justifyContent="space-between">
      {title.present ? (
        <Prim.Text fontSize="$xl" fontWeight="$semibold" color="$foreground">
          {stringify(title.value)}
        </Prim.Text>
      ) : (
        <Prim.Box />
      )}
      <Prim.Row gap="$2" alignItems="center" flexWrap="wrap">
        {section.reveals?.length ? (
          <Prim.Pressable
            onClick={() => toggleReveal(section.reveals ?? [])}
            display="flex"
            flexDirection="row"
            alignItems="center"
            gap="$1.5"
            borderWidth={1}
            borderColor="$border"
            borderRadius="$radius-md"
            paddingHorizontal="$3"
            paddingVertical="$1.5"
            backgroundColor={open ? '$accent' : '$background'}
          >
            <ViewIcon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
            <Prim.Text fontSize="$sm">{open ? 'Hide' : 'Show'}</Prim.Text>
          </Prim.Pressable>
        ) : null}
        {(section.actions ?? []).map((item, i) => (
          <ActionItemButton key={i} item={item} scope={scope} />
        ))}
      </Prim.Row>
    </Prim.Row>
  )
}

/** A shared skeleton, re-exported so the section index has one import site. */
export { LoadingState }
