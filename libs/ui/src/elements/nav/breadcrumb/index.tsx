import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Breadcrumb — the idiomatic `.breadcrumb`. Renders `Prim.Box as="nav"` / `Prim.Text` (real host
 * tags at runtime via `createComponent`) with the styling as `$`-token PROPS from
 * its retired `styled()` proof (docs/tamagui-idiomatic-migration.md §4). `breadcrumb/index.css` is deleted.
 *
 * The stylesheet's `.breadcrumb__segment:last-child` rule becomes an explicit `isCurrent` branch —
 * the component already knows which segment is last (it sets `aria-current` from the same test), so
 * the positional selector needs no CSS. (`transition-colors` awaits the animation driver, §5/P4.)
 */
export interface BreadcrumbSegment {
  label: string
  onClick?: () => void
}

export interface BreadcrumbProps extends React.ComponentProps<'nav'> {
  segments: BreadcrumbSegment[]
  separator?: React.ReactNode
}

/** `.breadcrumb` — flex, items-center, gap-1, text-sm, text-muted-foreground. */
const BREADCRUMB = {
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  fontSize: '$sm',
  color: '$muted-foreground',
} as const

/** `.breadcrumb__segment` — clickable, hovers to foreground. */
const SEGMENT = { cursor: 'pointer', hoverStyle: { color: '$foreground' } } as const

/** `.breadcrumb__segment:last-child` — the current page: foreground, not clickable. */
const SEGMENT_CURRENT = { color: '$foreground', cursor: 'default' } as const

/** `.breadcrumb__separator` — muted, unselectable. */
const SEPARATOR = { color: '$muted-foreground', userSelect: 'none' } as const

function Breadcrumb({ segments, separator = '/', ...props }: BreadcrumbProps) {
  return (
    <Prim.Box as="nav" aria-label="breadcrumb" {...BREADCRUMB} {...(props as Record<string, unknown>)}>
      {segments.map((segment, index) => {
        const isCurrent = index === segments.length - 1
        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <Prim.Text {...SEPARATOR} aria-hidden="true">
                {separator}
              </Prim.Text>
            )}
            <Prim.Text
              {...SEGMENT}
              {...(isCurrent ? SEGMENT_CURRENT : {})}
              onClick={segment.onClick}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {segment.label}
            </Prim.Text>
          </React.Fragment>
        )
      })}
    </Prim.Box>
  )
}

export { Breadcrumb }
