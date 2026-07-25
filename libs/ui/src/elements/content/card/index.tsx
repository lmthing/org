import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Card — the idiomatic `.card`. Renders `Prim.Box` (real `<div>`s at runtime via `createComponent`)
 * with the styling as `$`-token PROPS transcribed from its retired `styled()` proof (docs/tamagui-idiomatic-migration.md §4).
 * `card/index.css` is deleted; the prop bags are exported because callers carried `card`/`card__body`
 * directly on a `Prim.Box` rather than going through this element.
 */
export interface CardProps extends React.ComponentProps<'div'> {
  interactive?: boolean
}

/**
 * `.card` base — rounded-lg, border-border, bg-card, text-card-foreground, shadow-sm.
 * `shadow-sm` is the single-layer Tamagui approximation from the proof; the shadow colour follows
 * the codebase's opaque-black-with-alpha convention (theme-independent, so not a token).
 */
export const CARD_BASE = {
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$card',
  color: '$card-foreground',
  shadowColor: 'rgba(0,0,0,0.05)', // ds-lint-ok: shadow alpha-black, not a themed surface colour
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 2,
} as const

/** `.card--interactive` — cursor-pointer + hover:shadow-md. (`transition-shadow` awaits the animation driver, §5/P4.) */
export const CARD_INTERACTIVE = {
  cursor: 'pointer',
  hoverStyle: {
    shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
  },
} as const

/** `.card__header` — flex, flex-col, gap-1.5, p-4, pb-0. */
export const CARD_HEADER = {
  display: 'flex',
  flexDirection: 'column',
  gap: '$1.5',
  padding: '$4',
  paddingBottom: 0,
} as const

/** `.card__body` — p-4. */
export const CARD_BODY = { padding: '$4' } as const

/** `.card__footer` — flex, items-center, p-4, pt-0. */
export const CARD_FOOTER = {
  display: 'flex',
  alignItems: 'center',
  padding: '$4',
  paddingTop: 0,
} as const

function Card({ interactive, ...props }: CardProps) {
  return (
    <Prim.Box
      {...CARD_BASE}
      {...(interactive ? CARD_INTERACTIVE : {})}
      {...(props as Record<string, unknown>)}
    />
  )
}

function CardHeader(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...CARD_HEADER} {...(props as Record<string, unknown>)} />
}

function CardBody(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...CARD_BODY} {...(props as Record<string, unknown>)} />
}

function CardFooter(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...CARD_FOOTER} {...(props as Record<string, unknown>)} />
}

export { Card, CardHeader, CardBody, CardFooter }
