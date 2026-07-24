/**
 * breadcrumb.styled.tsx — P2 composite conversion of the `.breadcrumb` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/breadcrumb/index.css —
 * the `.breadcrumb` row + the `.breadcrumb__segment`/`__separator` parts (incl. the `:last-child`
 * current-segment styling) — into idiomatic Tamagui `styled()` frames.
 *
 * `.breadcrumb__segment:last-child` (the current page: foreground + default cursor) can't be a
 * structural pseudo on a Tamagui frame, so it becomes a `current` variant applied to the last segment
 * by the component. `transition-colors` awaits the animation driver (§5/P4). Lands alongside the
 * shipped className Breadcrumb (index.tsx); breadcrumb-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View, Text } from '../../../theme/tamagui-web.config'

/** `.breadcrumb` — flex, items-center, gap-1, text-sm, text-muted-foreground. */
export const BreadcrumbFrame = styled(View, {
  name: 'Breadcrumb',
  tag: 'nav',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  fontSize: '$sm',
  color: '$muted-foreground',
})

/**
 * `.breadcrumb__segment` — hover:text-foreground, cursor-pointer + the `:last-child` current variant
 * (text-foreground, cursor-default).
 */
export const BreadcrumbSegmentFrame = styled(Text, {
  name: 'BreadcrumbSegment',
  tag: 'span',
  cursor: 'pointer',
  hoverStyle: { color: '$foreground' },

  variants: {
    current: {
      true: { color: '$foreground', cursor: 'default' },
    },
  } as const,
})

/** `.breadcrumb__separator` — text-muted-foreground, select-none. */
export const BreadcrumbSeparatorFrame = styled(Text, {
  name: 'BreadcrumbSeparator',
  tag: 'span',
  color: '$muted-foreground',
  userSelect: 'none',
})

export interface BreadcrumbSegmentData {
  label: string
  onClick?: () => void
}

export interface StyledBreadcrumbProps extends React.ComponentProps<'nav'> {
  segments: BreadcrumbSegmentData[]
  separator?: React.ReactNode
}

const Frame = BreadcrumbFrame as unknown as React.ComponentType<any>
const Segment = BreadcrumbSegmentFrame as unknown as React.ComponentType<any>
const Separator = BreadcrumbSeparatorFrame as unknown as React.ComponentType<any>

/** Idiomatic Breadcrumb — same public API as the shipped className Breadcrumb (`segments`/`separator`). */
export function StyledBreadcrumb({ segments, separator = '/', ...props }: StyledBreadcrumbProps) {
  return (
    <Frame aria-label="breadcrumb" {...props}>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <React.Fragment key={index}>
            {index > 0 && <Separator aria-hidden="true">{separator}</Separator>}
            <Segment current={isLast} onPress={segment.onClick} aria-current={isLast ? 'page' : undefined}>
              {segment.label}
            </Segment>
          </React.Fragment>
        )
      })}
    </Frame>
  )
}
