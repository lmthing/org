/**
 * The 24-element catalogue, and the slot dispatcher above it.
 *
 * **Lifted, not rewritten.** The audit found 19 of the 24 already had a renderable,
 * mostly native-forked implementation — in `chat/components/render-descriptor.tsx` (the
 * 42-type descriptor renderer, already native-tested) and in `elements/*`. Prop names
 * follow `render-descriptor.tsx` wherever it already has the element; the two deliberate
 * divergences are stated in the schema and honoured here:
 *
 *  1. **tone, never colour.** The descriptor renderer takes a free-string `color` and a
 *     free-string banner `variant`. A free string is exactly what a weak model gets wrong,
 *     so a spec has one finite `tone` everywhere and the renderer owns the token.
 *  2. **list-shaped props carry BINDINGS**, not pre-materialised data. A spec is authored
 *     before the data exists, so `table.rows` is a path and the columns resolve per row.
 *
 * ## Two rules that run through every element here
 *
 * **S1 — a null binding omits its element.** A bound value that resolves to nothing
 * renders NOTHING, its label and wrapper included. This is what replaces the ~15
 * hand-written `{x ? … : null}` guards across ten pages and it is the only reason the
 * no-conditionals rule stays honest: without it, every spec page fills with empty chrome.
 * A LITERAL is never omitted — the author wrote it on purpose.
 *
 * **Every string sits inside a `Prim.Text`.** React Native refuses a bare string inside a
 * View and then DROPS it, so a label vanishes on a phone rather than erroring. Neither
 * jsdom nor `react-test-renderer` enforces the rule, which is why the metro suite asserts
 * on the host TYPE of the mounted node.
 *
 * ## Repeater convention
 *
 * Stated once here, used by `table`, `timeline` and every collection section: an element
 * with an `items`/`rows` BINDING to an array opens a new `$` scope for the value props
 * evaluated per entry. Nothing else in the language creates scope.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import { Markdown } from '../elements/content/markdown'
import type {
  ActionItem,
  ElementNode,
  FlatItem,
  FlatValue,
  Formatted,
  KeyValuePair,
  Slot,
  TableColumn,
  Toned,
  Tone,
} from './types'
import { isComponentRef, isElementNode } from './types'
import {
  fillRoute,
  itemScope,
  resolveArray,
  resolveInputs,
  resolveOptional,
  resolveValue,
  lastSegment,
  type Scope,
} from './bind'
import { formatBound, resolveTone, stringify, toneTokens } from './format'
import { ViewIcon, StarGlyph } from './icons'
import { HScroll } from './hscroll'
import { ActionButton, ActionRow, useDispatch } from './actions'
import { useViewMutation, useViewRuntime } from './runtime'
import { RatingControl, SelectControl, StepperControl, TextControl, ToggleControl } from './controls'
import { EmptyStateView } from './states'

// ── slot dispatch ────────────────────────────────────────────────────────────

/**
 * Render anything that fills a slot: an element tree, a component reference, or the flat
 * item form. Which one it is, is decided the way the JSON Schema decides — `el`, then
 * `use`, then flat — so a spec that validates renders through the same branch it was
 * checked against.
 */
export function renderSlot(slot: Slot | undefined, scope: Scope, key?: React.Key): React.ReactNode {
  if (!slot) return null
  if (isElementNode(slot)) return renderElement(slot, scope, key)
  if (isComponentRef(slot)) return <ComponentUse key={key} node={slot} scope={scope} />
  return <FlatItemView key={key} item={slot} scope={scope} />
}

/** Render a list of slots. */
export function renderSlots(slots: Slot[] | undefined, scope: Scope): React.ReactNode {
  if (!slots) return null
  return slots.map((slot, i) => renderSlot(slot, scope, i))
}

/**
 * A `{ use: 'RecipeCard', props: { … } }` reference.
 *
 * The component's node is rendered in a scope where `$props.*` is the resolved prop map
 * and `$` is unchanged — a component sees the row it was placed on, exactly as an inline
 * element tree would, so lifting a repeated shape into a component is a pure refactor.
 * Component definitions are acyclic by validation, so recursion terminates.
 */
function ComponentUse({ node, scope }: { node: { use: string; props?: Record<string, string> }; scope: Scope }) {
  const { components } = useViewRuntime()
  const def = components[node.use]
  if (!def) {
    // A save-time validation failure that somehow reached a device. Name it rather than
    // rendering a blank — the same menu-shaped philosophy the writers use.
    return (
      <Prim.Text fontSize="$xs" color="$destructive">
        {`Unknown component "${node.use}"`}
      </Prim.Text>
    )
  }
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.props ?? {})) {
    props[key] = resolveOptional(value, scope)
  }
  return <>{renderSlot(def.node, { ...scope, props })}</>
}

// ── the flat item ────────────────────────────────────────────────────────────

/** Split a {@link FlatValue} into its value expression and its modifiers. */
function flatParts(fv: FlatValue): { value: string; mods: Formatted & Toned & { maxLines?: number } } {
  return typeof fv === 'string' ? { value: fv, mods: {} } : { value: fv.value, mods: fv }
}

/** Resolve a flat slot to display text, honouring S1. `undefined` ⇒ omit. */
function flatText(fv: FlatValue | undefined, scope: Scope): { text: string; mods: Formatted & Toned & { maxLines?: number } } | undefined {
  if (fv === undefined) return undefined
  const { value, mods } = flatParts(fv)
  const r = resolveValue(value, scope)
  if (!r.present) return undefined
  return { text: formatBound(r.value, mods, scope), mods }
}

/**
 * The flat convenience form — the shortest way to write a row (`{ title: '$.name' }`) and
 * what the model should reach for first.
 *
 * The key set is sized from ten real hand-written specs, not from taste: a flat form that
 * cannot express an ordinary row just pushes every row into an element tree, which is the
 * verbosity it exists to prevent. Layout is the renderer's: image left, the text column,
 * the headline figure right, controls under.
 */
export function FlatItemView({ item, scope }: { item: FlatItem; scope: Scope }): React.ReactElement | null {
  const dispatch = useDispatch()

  const title = flatText(item.title, scope)
  const subtitle = flatText(item.subtitle, scope)
  const caption = flatText(item.caption, scope)
  const meta = flatText(item.meta, scope)
  const value = flatText(item.value, scope)
  const suffix = flatText(item.suffix, scope)
  const note = flatText(item.note, scope)
  const markdown = flatText(item.markdown, scope)
  const badge = flatText(item.badge, scope)
  const status = flatText(item.status, scope)
  const image = flatText(item.image, scope)
  const badges = item.badges ? resolveArray(item.badges, scope) : []

  const line = (
    part: { text: string; mods: Formatted & Toned & { maxLines?: number } } | undefined,
    props: Record<string, unknown>,
  ) => {
    if (!part) return null
    const tone = part.mods.tone || part.mods.toneMap ? resolveTone(part.mods, part.text, scope) : undefined
    return (
      <Prim.Text
        {...props}
        {...(tone ? { color: toneTokens(tone).fg } : {})}
        {...(part.mods.maxLines ? clampProps(part.mods.maxLines) : {})}
      >
        {part.text}
      </Prim.Text>
    )
  }

  const body = (
    <Prim.Col gap="$1" flexGrow={1} flexShrink={1} flexBasis="0%">
      {line(title, { fontSize: '$sm', fontWeight: '$medium', color: '$foreground' })}
      {line(subtitle, { fontSize: '$sm', color: '$foreground' })}
      {line(caption, { fontSize: '$xs', color: '$muted-foreground' })}
      {markdown ? <Markdown source={markdown.text} preset="prose" /> : null}
      {badge || status || badges.length > 0 || meta ? (
        <Prim.Row gap="$1.5" flexWrap="wrap" alignItems="center">
          {badge ? <Pill text={badge.text} tone={resolveTone(badge.mods, badge.text, scope)} /> : null}
          {status ? <Pill text={status.text} tone={resolveTone({ tone: 'auto', ...status.mods }, status.text, scope)} /> : null}
          {badges.map((b, i) => (
            <Pill key={i} text={stringify(b)} tone="neutral" />
          ))}
          {line(meta, { fontSize: '$xs', color: '$muted-foreground' })}
        </Prim.Row>
      ) : null}
      {item.keyvalue ? <KeyValueRows pairs={item.keyvalue} scope={scope} layout="inline" /> : null}
      {line(note, { fontSize: '$xs', color: '$muted-foreground', fontStyle: 'italic' })}
    </Prim.Col>
  )

  const inner = (
    <Prim.Col gap="$2">
      <Prim.Row gap="$3" alignItems="flex-start">
        {image ? (
          <Prim.Image
            src={image.text}
            alt={title?.text ?? ''}
            width={56}
            height={56}
            borderRadius="$radius"
            objectFit="cover"
          />
        ) : null}
        {item.icon ? <ViewIcon name={item.icon} size="md" /> : null}
        {body}
        {value ? (
          <Prim.Col alignItems="flex-end" gap="$0.5">
            {line(value, { fontSize: '$sm', fontWeight: '$semibold', color: '$foreground' })}
            {line(suffix, { fontSize: '$xs', color: '$muted-foreground' })}
          </Prim.Col>
        ) : null}
      </Prim.Row>
      <ActionRow items={item.actions} scope={scope} />
    </Prim.Col>
  )

  // A tappable row. Nested controls sit INSIDE the pressable, and `ActionButton` stops the
  // press from reaching the row because a nested pressable is the responder — the audit's
  // I6 note ("nested actions must not fire rowAction").
  if (item.action) {
    return (
      <Prim.Pressable onClick={() => void dispatch(item.action, scope)} display="flex" flexDirection="column">
        {inner}
      </Prim.Pressable>
    )
  }
  return inner
}

/** `maxLines` — clamp with an ellipsis. Both targets, two different prop names. */
function clampProps(maxLines: number): Record<string, unknown> {
  return {
    // Web: the line-clamp trio. Native: RN's own prop, which Tamagui forwards.
    numberOfLines: maxLines,
    display: '-webkit-box',
    overflow: 'hidden',
    style: { WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' },
  }
}

/** The one pill drawing — `badge`, a flat `status`, a tag from `badges`. */
function Pill({
  text,
  tone,
  shape = 'pill',
  icon,
}: {
  text: string
  tone: Exclude<Tone, 'auto'>
  shape?: 'badge' | 'pill' | 'tag'
  icon?: string
}) {
  const t = toneTokens(tone)
  return (
    <Prim.Row
      alignItems="center"
      gap="$1"
      borderRadius={shape === 'pill' ? '$radius-full' : '$radius'}
      borderWidth={1}
      borderColor={t.border}
      backgroundColor={t.bg}
      paddingHorizontal="$2"
      paddingVertical="$0.5"
    >
      {icon ? <ViewIcon name={icon} size={12} color={t.fg} /> : null}
      <Prim.Text fontSize="$xs" fontWeight="$medium" color={t.fg}>
        {text}
      </Prim.Text>
    </Prim.Row>
  )
}

/** A definition list. `layout: 'inline'` per audit A12 (`trips/BudgetStrip`). */
function KeyValueRows({
  pairs,
  scope,
  layout = 'stacked',
}: {
  pairs: KeyValuePair[]
  scope: Scope
  layout?: 'stacked' | 'inline'
}) {
  const rows = pairs
    .map((pair, i) => {
      const r = resolveValue(pair.value, scope)
      // S1 at the PAIR level: a keyvalue row whose value is missing takes its label with
      // it, rather than leaving "Paid by · " hanging.
      if (!r.present) return null
      const label = stringify(resolveOptional(pair.label, scope) ?? pair.label)
      return { key: i, label, value: formatBound(r.value, pair, scope) }
    })
    .filter((r): r is { key: number; label: string; value: string } => r !== null)

  if (rows.length === 0) return null

  if (layout === 'inline') {
    return (
      <Prim.Row gap="$4" flexWrap="wrap">
        {rows.map((row) => (
          <Prim.Row key={row.key} gap="$1" alignItems="baseline">
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {row.label}
            </Prim.Text>
            <Prim.Text fontSize="$sm" fontWeight="$medium" color="$foreground">
              {row.value}
            </Prim.Text>
          </Prim.Row>
        ))}
      </Prim.Row>
    )
  }

  return (
    <Prim.Col gap="$1.5">
      {rows.map((row) => (
        <Prim.Row key={row.key} gap="$3" alignItems="flex-start">
          <Prim.Text fontSize="$xs" color="$muted-foreground" minWidth={120}>
            {row.label}
          </Prim.Text>
          <Prim.Text fontSize="$sm" color="$foreground" flexGrow={1} flexShrink={1} flexBasis="0%">
            {row.value}
          </Prim.Text>
        </Prim.Row>
      ))}
    </Prim.Col>
  )
}

export { KeyValueRows, Pill, clampProps }

// ── the elements ─────────────────────────────────────────────────────────────

const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' } as const
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const

/**
 * Draw one element node.
 *
 * A pure function, not a component, for the same reason dispatch is: an element tree is
 * recursive and variable in shape, so making every node a component would put a variable
 * number of hooks in a row. The FOUR elements that genuinely need state or data —
 * `button`, `field`, `statcard`'s action, `surface`'s action — delegate to small
 * components declared below, which is where their hooks live.
 */
export function renderElement(node: ElementNode, scope: Scope, key?: React.Key): React.ReactNode {
  switch (node.el) {
    // ── layout ──
    case 'row': {
      const children = renderSlots(node.children, scope)
      if (node.scroll === 'x') {
        return (
          <HScroll key={key} gap={node.gap ?? 8} alignItems={node.align ? ALIGN[node.align] : undefined}>
            {children}
          </HScroll>
        )
      }
      return (
        <Prim.Row
          key={key}
          gap={node.gap ?? 8}
          justifyContent={JUSTIFY[node.justify ?? 'start']}
          alignItems={ALIGN[node.align ?? 'start']}
          flexWrap={node.wrap ? 'wrap' : 'nowrap'}
        >
          {children}
        </Prim.Row>
      )
    }
    case 'col':
      return (
        <Prim.Col key={key} gap={node.gap ?? 8} alignItems={ALIGN[node.align ?? 'stretch']}>
          {renderSlots(node.children, scope)}
        </Prim.Col>
      )
    case 'grid': {
      const columns = Math.max(1, node.columns ?? 2)
      const children = node.children ?? []
      if (node.scroll === 'x') {
        return (
          <HScroll key={key} gap={node.gap ?? 12}>
            {children.map((child, i) => (
              <Prim.Box key={i} minWidth={200}>
                {renderSlot(child, scope)}
              </Prim.Box>
            ))}
          </HScroll>
        )
      }
      // Percentage widths on a wrapping row, not CSS grid: Yoga has no `display: grid`,
      // and this is the one layout both targets compute identically. The `$sm` override
      // is the responsive collapse — one column on a phone, `columns` from 640px up. The
      // model never writes a breakpoint.
      const pct = `${100 / columns}%`
      return (
        <Prim.Row key={key} flexWrap="wrap" gap={node.gap ?? 12} alignItems="stretch">
          {children.map((child, i) => (
            <Prim.Box key={i} width="100%" $sm={{ width: pct, maxWidth: pct }} flexGrow={1}>
              {renderSlot(child, scope)}
            </Prim.Box>
          ))}
        </Prim.Row>
      )
    }
    case 'spacer':
      return <Prim.Box key={key} flexGrow={1} />
    case 'divider': {
      const label = resolveValue(node.label, scope)
      return (
        <Prim.Row key={key} gap="$2" alignItems="center" marginVertical="$2">
          <Prim.Box height={1} backgroundColor="$border" flexGrow={1} />
          {label.present ? (
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {stringify(label.value)}
            </Prim.Text>
          ) : null}
          <Prim.Box height={1} backgroundColor="$border" flexGrow={1} />
        </Prim.Row>
      )
    }
    case 'surface':
      return <SurfaceElement key={key} node={node} scope={scope} />

    // ── typography ──
    case 'heading': {
      const r = resolveValue(node.text, scope)
      if (!r.present) return null
      const level = node.level ?? 2
      const size = level === 1 ? '$2xl' : level === 2 ? '$xl' : level === 3 ? '$base' : '$sm'
      return (
        <Prim.Text
          key={key}
          as={`h${level}` as 'h1'}
          fontSize={size}
          fontWeight="$semibold"
          letterSpacing="$tight"
          color="$foreground"
        >
          {stringify(r.value)}
        </Prim.Text>
      )
    }
    case 'text': {
      const r = resolveValue(node.text, scope)
      if (!r.present) return null
      const tone = node.tone || node.toneMap ? resolveTone(node, r.value, scope) : undefined
      return (
        <Prim.Text
          key={key}
          fontSize="$sm"
          color={tone ? toneTokens(tone).fg : node.dim ? '$muted-foreground' : '$foreground'}
          {...(node.bold ? { fontWeight: '$semibold' } : {})}
          {...(node.italic ? { fontStyle: 'italic' as const } : {})}
          {...(node.strike ? { textDecorationLine: 'line-through' as const } : {})}
          {...(node.maxLines ? clampProps(node.maxLines) : {})}
        >
          {formatBound(r.value, node, scope)}
        </Prim.Text>
      )
    }
    case 'caption': {
      const r = resolveValue(node.text, scope)
      if (!r.present) return null
      const tone = node.tone || node.toneMap ? resolveTone(node, r.value, scope) : undefined
      return (
        <Prim.Text
          key={key}
          fontSize="$xs"
          lineHeight="1.375em"
          color={tone ? toneTokens(tone).fg : '$muted-foreground'}
          {...(node.maxLines ? clampProps(node.maxLines) : {})}
        >
          {formatBound(r.value, node, scope)}
        </Prim.Text>
      )
    }
    case 'markdown': {
      const r = resolveValue(node.text, scope)
      if (!r.present) return null
      // The same renderer the transcript uses, so an agent-written summary inside a row
      // and the same text in chat cannot render differently. Absorbs the corpus's five
      // hand-built `MarkdownBody` components (1,435 LOC).
      return <Markdown key={key} source={stringify(r.value)} preset="prose" />
    }

    // ── data display ──
    case 'badge': {
      const r = resolveValue(node.text, scope)
      if (!r.present) return null
      const text = stringify(r.value)
      return <Pill key={key} text={text} tone={resolveTone(node, r.value, scope)} shape={node.shape} icon={node.icon} />
    }
    case 'statcard':
      return <StatcardElement key={key} node={node} scope={scope} />
    case 'meter':
      return <MeterElement key={key} node={node} scope={scope} />
    case 'keyvalue':
      return <KeyValueRows key={key} pairs={node.pairs} scope={scope} layout={node.layout} />
    case 'table': {
      const rows = resolveArray(node.rows, scope)
      if (rows.length === 0) return null
      const table = <TableBody columns={node.columns} rows={rows} scope={scope} />
      // Without `scroll: 'x'` a wide table is CLIPPED on a phone with no gesture to reach
      // the rest of it — this is the reason the prop exists.
      return node.scroll === 'x' ? <HScroll key={key}>{table}</HScroll> : <Prim.Box key={key}>{table}</Prim.Box>
    }
    case 'timeline': {
      const items = resolveArray(node.items, scope)
      if (items.length === 0) return null
      return (
        <Prim.Col key={key} gap="$3" borderLeftWidth={1} borderColor="$border" paddingLeft="$3">
          {items.map((item, i) => {
            const s = itemScope(scope, item)
            const title = resolveValue(node.title, s)
            const time = resolveValue(node.time, s)
            const detail = resolveValue(node.detail, s)
            return (
              <Prim.Col key={i} gap="$0.5">
                <Prim.Row gap="$2" alignItems="baseline">
                  {node.icon ? <ViewIcon name={node.icon} size="sm" /> : null}
                  {title.present ? (
                    <Prim.Text fontSize="$sm" fontWeight="$medium" color="$foreground">
                      {stringify(title.value)}
                    </Prim.Text>
                  ) : null}
                  {time.present ? (
                    <Prim.Text fontSize="$xs" color="$muted-foreground">
                      {formatBound(time.value, node, s)}
                    </Prim.Text>
                  ) : null}
                </Prim.Row>
                {detail.present ? (
                  <Prim.Text fontSize="$xs" color="$muted-foreground">
                    {stringify(detail.value)}
                  </Prim.Text>
                ) : null}
              </Prim.Col>
            )
          })}
        </Prim.Col>
      )
    }
    case 'rating': {
      const r = resolveValue(node.value, scope)
      if (!r.present) return null
      const n = Number(r.value) || 0
      const max = node.max ?? 5
      return (
        <Prim.Row key={key} gap="$0.5" alignItems="center">
          {Array.from({ length: max }, (_, i) => (
            <StarGlyph key={i} filled={i < n} size={14} />
          ))}
        </Prim.Row>
      )
    }

    // ── media ──
    case 'image': {
      const r = resolveValue(node.src, scope)
      if (!r.present) return null
      // A fixed height per ratio rather than `aspectRatio`: the web `Image` primitive does
      // not carry that style prop, and a percentage height inside a Yoga column resolves
      // to zero on native. Three heights cover every measured use (a card hero, a square
      // thumbnail, a portrait listing photo).
      const height = node.ratio === 'square' ? 220 : node.ratio === 'tall' ? 280 : 180
      return (
        <Prim.Image
          key={key}
          src={stringify(r.value)}
          alt={stringify(resolveOptional(node.alt, scope) ?? '')}
          width="100%"
          height={height}
          borderRadius="$radius"
          objectFit={node.fit ?? 'cover'}
        />
      )
    }
    case 'icon':
      return <ViewIcon key={key} name={node.name} size={node.size ?? 'md'} tone={node.tone === 'auto' ? undefined : node.tone} />

    // ── feedback ──
    case 'banner': {
      const r = resolveValue(node.text, scope)
      if (!r.present) return null
      const tone = resolveTone(node, r.value, scope)
      const t = toneTokens(tone)
      const title = resolveValue(node.title, scope)
      return (
        <Prim.Row
          key={key}
          gap="$2"
          alignItems="flex-start"
          borderLeftWidth={3}
          borderColor={t.fg}
          backgroundColor={t.bg}
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderRadius="$radius"
        >
          {node.icon ? <ViewIcon name={node.icon} size="sm" color={t.fg} /> : null}
          <Prim.Col gap="$0.5" flexGrow={1} flexShrink={1} flexBasis="0%">
            {title.present ? (
              <Prim.Text fontSize="$sm" fontWeight="$semibold" color={t.fg}>
                {stringify(title.value)}
              </Prim.Text>
            ) : null}
            <Prim.Text fontSize="$sm" color="$foreground">
              {stringify(r.value)}
            </Prim.Text>
          </Prim.Col>
        </Prim.Row>
      )
    }
    case 'empty':
      return <EmptySlot key={key} state={node} scope={scope} />

    // ── interactive ──
    case 'button':
      return <ButtonElement key={key} node={node} scope={scope} />
    case 'link':
      return <LinkElement key={key} node={node} scope={scope} />
    case 'field':
      return <FieldElement key={key} node={node} scope={scope} />

    default: {
      // The union is closed. This makes an element added to the contract and not drawn
      // here a `pnpm typecheck` failure, not a blank square on a phone.
      const never: never = node
      void never
      return null
    }
  }
}

// ── the elements that hold state or data ─────────────────────────────────────

function SurfaceElement({ node, scope }: { node: Extract<ElementNode, { el: 'surface' }>; scope: Scope }) {
  const dispatch = useDispatch()
  const tone = node.tone || node.toneMap ? resolveTone(node, undefined, scope) : undefined
  const title = resolveValue(node.title, scope)
  const body = (
    <Prim.Col
      gap="$2"
      padding="$4"
      borderWidth={1}
      borderColor={tone ? toneTokens(tone).fg : '$border'}
      borderRadius="$radius-lg"
      backgroundColor="$card"
      {...(tone ? { borderLeftWidth: 3 } : {})}
    >
      {title.present ? (
        <Prim.Text fontSize="$sm" fontWeight="$semibold" color="$card-foreground">
          {stringify(title.value)}
        </Prim.Text>
      ) : null}
      {renderSlots(node.children, scope)}
    </Prim.Col>
  )
  if (!node.action) return body
  return (
    <Prim.Pressable onClick={() => void dispatch(node.action, scope)} display="flex" flexDirection="column">
      {body}
    </Prim.Pressable>
  )
}

function StatcardElement({ node, scope }: { node: Extract<ElementNode, { el: 'statcard' }>; scope: Scope }) {
  const dispatch = useDispatch()
  const v = resolveValue(node.value, scope)
  if (!v.present) return null
  const label = stringify(resolveOptional(node.label, scope) ?? node.label)
  const delta = resolveValue(node.delta, scope)
  const tone = node.tone || node.toneMap ? resolveTone(node, v.value, scope) : undefined

  const card = (
    <Prim.Col
      gap="$1"
      padding="$4"
      borderWidth={1}
      borderColor="$border"
      borderRadius="$radius-lg"
      backgroundColor="$card"
      minWidth={140}
      flexGrow={1}
    >
      <Prim.Row gap="$1.5" alignItems="center">
        {node.icon ? <ViewIcon name={node.icon} size="sm" tone={tone} /> : null}
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {label}
        </Prim.Text>
      </Prim.Row>
      <Prim.Text fontSize="$2xl" fontWeight="$semibold" color={tone ? toneTokens(tone).fg : '$card-foreground'}>
        {formatBound(v.value, node, scope)}
      </Prim.Text>
      {delta.present ? (
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {stringify(delta.value)}
        </Prim.Text>
      ) : null}
    </Prim.Col>
  )
  if (!node.action) return card
  return (
    <Prim.Pressable onClick={() => void dispatch(node.action, scope)} display="flex" flexDirection="column" flexGrow={1}>
      {card}
    </Prim.Pressable>
  )
}

/**
 * `meter` — the descriptor renderer's `progressbar`, plus the two variants the corpus
 * needed (audit A5: `ScoreBadge` is the whole `homes` feed, `RelevanceMeter`, cooking-mode
 * progress) and the tone `progressbar` never had (A1).
 *
 * `ring` is drawn as an SVG arc, which is one definition on both targets — `react-native-svg`
 * has `strokeDasharray`.
 */
function MeterElement({ node, scope }: { node: Extract<ElementNode, { el: 'meter' }>; scope: Scope }) {
  const v = resolveValue(node.value, scope)
  if (!v.present) return null
  const raw = Number(v.value)
  if (!Number.isFinite(raw)) return null
  const maxRaw = typeof node.max === 'number' ? node.max : resolveOptional(node.max, scope)
  const max = Number(maxRaw ?? (raw <= 1 ? 1 : 100)) || 1
  const pct = Math.max(0, Math.min(100, (raw / max) * 100))
  const tone = resolveTone(node, raw, scope)
  const t = toneTokens(tone)
  const label = resolveValue(node.label, scope)

  if (node.variant === 'ring') {
    const r = 14
    const circumference = 2 * Math.PI * r
    return (
      <Prim.Row gap="$2" alignItems="center">
        <Prim.Svg width={36} height={36} viewBox="0 0 36 36" fill="none">
          <Prim.Circle cx="18" cy="18" r={r} stroke="$border" strokeWidth={4} />
          <Prim.Circle
            cx="18"
            cy="18"
            r={r}
            stroke={t.fg}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
            transform="rotate(-90 18 18)"
          />
        </Prim.Svg>
        <Prim.Col>
          <Prim.Text fontSize="$sm" fontWeight="$semibold" color={t.fg}>
            {`${Math.round(pct)}%`}
          </Prim.Text>
          {label.present ? (
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {stringify(label.value)}
            </Prim.Text>
          ) : null}
        </Prim.Col>
      </Prim.Row>
    )
  }

  if (node.variant === 'segments') {
    const total = Math.max(1, Math.round(max))
    const filled = Math.round((pct / 100) * total)
    return (
      <Prim.Col gap="$1">
        <Prim.Row gap="$1">
          {Array.from({ length: Math.min(total, 20) }, (_, i) => (
            <Prim.Box
              key={i}
              height={6}
              flexGrow={1}
              borderRadius="$radius"
              backgroundColor={i < filled ? t.fg : '$muted'}
            />
          ))}
        </Prim.Row>
        {label.present ? (
          <Prim.Text fontSize="$xs" color="$muted-foreground">
            {stringify(label.value)}
          </Prim.Text>
        ) : null}
      </Prim.Col>
    )
  }

  return (
    <Prim.Col gap="$1">
      <Prim.Box height={8} borderRadius="$radius-full" backgroundColor="$muted" overflow="hidden">
        <Prim.Box height="100%" width={`${pct}%`} backgroundColor={t.fg} />
      </Prim.Box>
      {label.present ? (
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {stringify(label.value)}
        </Prim.Text>
      ) : null}
    </Prim.Col>
  )
}

function TableBody({ columns, rows, scope }: { columns: TableColumn[]; rows: unknown[]; scope: Scope }) {
  const align = (a?: 'start' | 'center' | 'end') => (a === 'end' ? 'right' : a === 'center' ? 'center' : 'left')
  return (
    <Prim.Table borderColor="$border" fontSize="$xs">
      <Prim.Thead>
        <Prim.Tr>
          {columns.map((col, i) => (
            <Prim.Th
              key={i}
              textAlign={align(col.align)}
              fontWeight="$semibold"
              color="$muted-foreground"
              borderBottomWidth={1}
              borderColor="$border"
              paddingHorizontal="$2"
              paddingVertical="$1.5"
            >
              <Prim.Text fontSize="$xs" color="$muted-foreground">
                {stringify(resolveOptional(col.label, scope) ?? col.label)}
              </Prim.Text>
            </Prim.Th>
          ))}
        </Prim.Tr>
      </Prim.Thead>
      <Prim.Tbody>
        {rows.map((row, ri) => {
          const s = itemScope(scope, row)
          return (
            <Prim.Tr key={ri}>
              {columns.map((col, ci) => {
                const r = resolveValue(col.value, s)
                return (
                  <Prim.Td
                    key={ci}
                    textAlign={align(col.align)}
                    borderBottomWidth={1}
                    borderColor="$border"
                    paddingHorizontal="$2"
                    paddingVertical="$1.5"
                  >
                    {/* Never a bare string: a cell's text is dropped on native without this. */}
                    <Prim.Text fontSize="$xs" color="$foreground">
                      {r.present ? formatBound(r.value, col, s) : ''}
                    </Prim.Text>
                  </Prim.Td>
                )
              })}
            </Prim.Tr>
          )
        })}
      </Prim.Tbody>
    </Prim.Table>
  )
}

/** The `empty` element / a section's `empty:` override, resolved against the scope. */
export function EmptySlot({
  state,
  scope,
}: {
  state: { title?: string; message?: string; icon?: string; action?: ActionItem }
  scope: Scope
}) {
  const dispatch = useDispatch()
  const { toggleReveal } = useViewRuntime()
  const action = state.action
  return (
    <EmptyStateView
      title={stringify(resolveOptional(state.title, scope) ?? state.title ?? '') || undefined}
      message={stringify(resolveOptional(state.message, scope) ?? state.message ?? '') || undefined}
      icon={state.icon as never}
      action={
        action ? (
          <ActionButton
            label={stringify(resolveOptional(action.label, scope) ?? action.label)}
            icon={action.icon}
            variant={action.variant ?? 'primary'}
            onPress={async () => {
              if (action.reveals?.length) toggleReveal(action.reveals)
              if (action.action) await dispatch(action.action, scope)
            }}
          />
        ) : undefined
      }
    />
  )
}

function ButtonElement({ node, scope }: { node: Extract<ElementNode, { el: 'button' }>; scope: Scope }) {
  const dispatch = useDispatch()
  const { toggleReveal } = useViewRuntime()
  const label = resolveValue(node.label, scope)
  if (!label.present) return null
  return (
    <ActionButton
      label={stringify(label.value)}
      icon={node.icon}
      tone={node.tone && node.tone !== 'auto' ? node.tone : undefined}
      variant={node.variant ?? 'secondary'}
      onPress={async () => {
        if (node.reveals?.length) toggleReveal(node.reveals)
        if (node.action) await dispatch(node.action, scope)
      }}
    />
  )
}

/**
 * `link` — in-app (`to`, a route) or external (`href`).
 *
 * `external` is opt-in (audit A10): `render-descriptor.tsx` HARDCODES `target=_blank`,
 * which is wrong for an in-app link and meaningless on native. `href` also carries
 * `tel:`/`mailto:` schemes (`health/EmergencyContact`).
 */
function LinkElement({ node, scope }: { node: Extract<ElementNode, { el: 'link' }>; scope: Scope }) {
  const { client, routeParams } = useViewRuntime()
  const text = resolveValue(node.text, scope)
  if (!text.present) return null

  const onPress = () => {
    if (node.to) {
      const params: Record<string, unknown> = { ...routeParams }
      for (const [k, b] of Object.entries(node.params ?? {})) {
        const v = resolveOptional(b, scope)
        if (v !== undefined) params[k] = v
      }
      client.navigate?.(fillRoute(node.to, params))
      return
    }
    const href = stringify(resolveOptional(node.href, scope))
    if (href) client.openExternal?.(href)
  }

  return (
    <Prim.Pressable onClick={onPress} display="flex" flexDirection="row" alignItems="center" gap="$1">
      {node.icon ? <ViewIcon name={node.icon} size="sm" color="$primary" /> : null}
      <Prim.Text fontSize="$sm" color="$primary" textDecorationLine="underline">
        {stringify(text.value)}
      </Prim.Text>
      {node.external ? <ViewIcon name="external-link" size={12} color="$primary" /> : null}
    </Prim.Pressable>
  )
}

/**
 * `field` — the inline-editable control, and the audit's one genuinely INEXPRESSIBLE
 * finding (I1, demand 12 across 5/5 apps).
 *
 * `button { mutate }` carries no argument, so without this a spec app renders every
 * catalogue page beautifully and lets a user change NOTHING about a row. The new control
 * value is sent under the Input key named by `arg` (defaulting to the last segment of
 * `value`'s path), alongside `input`'s bindings from the row scope.
 *
 * The value is held optimistically-in-name-only: the control shows what the user just
 * chose while the request is in flight, then the invalidated query overwrites it. That is
 * per-row pending treatment, which the plan names as v1's one honest loss versus a true
 * optimistic swap — and which is what all five apps actually do today.
 */
function FieldElement({ node, scope }: { node: Extract<ElementNode, { el: 'field' }>; scope: Scope }) {
  const bound = resolveOptional(node.value, scope)
  const mutation = useViewMutation(node.mutation, node.invalidates)
  const [draft, setDraft] = React.useState<unknown>(undefined)
  const [text, setText] = React.useState<string>('')
  const [dirty, setDirty] = React.useState(false)

  const current = draft !== undefined ? draft : bound
  const arg = node.arg ?? lastSegment(node.value)

  const submit = React.useCallback(
    async (next: unknown) => {
      setDraft(next)
      const { ready, values } = resolveInputs(node.input, scope)
      if (!ready) return
      try {
        await mutation.run({ ...values, [arg]: next })
      } catch {
        // The query invalidation the mutation would have triggered never ran, so the
        // control must fall back to the bound value rather than keeping a lie on screen.
        setDraft(undefined)
      }
    },
    [mutation, node.input, scope, arg],
  )

  const label = stringify(resolveOptional(node.label, scope) ?? '')

  switch (node.kind) {
    case 'toggle':
      return <ToggleControl value={!!current} onChange={(v) => void submit(v)} label={label || undefined} disabled={mutation.isPending} />
    case 'rating':
      return <RatingControl value={Number(current) || 0} onChange={(v) => void submit(v)} max={node.max ?? 5} disabled={mutation.isPending} />
    case 'stepper':
      return (
        <StepperControl
          value={Number(current) || 0}
          onChange={(v) => void submit(v)}
          min={node.min ?? 0}
          max={node.max ?? 100}
          step={node.step ?? 1}
          disabled={mutation.isPending}
        />
      )
    case 'select': {
      const raw = Array.isArray(node.options) ? node.options : resolveArray(node.options, scope)
      const options = raw.map((o) => ({ label: stringify(o), value: stringify(o) }))
      return (
        <SelectControl
          value={stringify(current)}
          options={options}
          onChange={(v) => void submit(v)}
          placeholder={stringify(resolveOptional(node.placeholder, scope) ?? 'Select…')}
          disabled={mutation.isPending}
        />
      )
    }
    case 'text': {
      // The one kind that does NOT submit on change: a reveal-then-submit note
      // (`homes/ListingCard`, `NeedsYouNow`) would fire a mutation per keystroke.
      const value = dirty ? text : stringify(current)
      return (
        <Prim.Col gap="$2">
          <TextControl
            value={value}
            onChange={(v) => {
              setDirty(true)
              setText(v)
            }}
            placeholder={stringify(resolveOptional(node.placeholder, scope) ?? '')}
            multiline
            disabled={mutation.isPending}
          />
          <ActionButton
            label={stringify(resolveOptional(node.submitLabel, scope) ?? 'Save')}
            variant="primary"
            size="sm"
            disabled={!dirty}
            onPress={async () => {
              await submit(text)
              setDirty(false)
            }}
          />
        </Prim.Col>
      )
    }
    default: {
      const never: never = node.kind
      void never
      return null
    }
  }
}
