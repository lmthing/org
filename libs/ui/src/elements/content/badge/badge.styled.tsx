/**
 * badge.styled.tsx — P2 leaf conversion of the `.badge` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/badge/index.css —
 * the `.badge` base + `.badge--primary`/`--muted`/`--success` — into ONE `styled(View, { variants })`
 * using the SPIKE-A1 var-backed `$` colors and SPIKE-B Tailwind scales.
 *
 * Lands alongside the shipped className Badge (index.tsx); badge-styled.test.tsx pins the variants.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.badge` base (inline-flex, items-center, rounded-full, px-2, py-0.5, text-xs, font-medium, border,
 * border-border, bg-secondary, text-secondary-foreground) + the `variant` modifiers.
 */
export const BadgeFrame = styled(View, {
  name: 'Badge',
  tag: 'span',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '$radius-full',
  paddingHorizontal: '$2',
  paddingVertical: '$0.5',
  fontSize: '$xs',
  fontWeight: '$medium',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$secondary',
  color: '$secondary-foreground',

  variants: {
    variant: {
      default: {}, // .badge base already carries the secondary surface
      primary: { backgroundColor: '$primary', color: '$primary-foreground', borderColor: 'transparent' },
      muted: { backgroundColor: '$muted', color: '$muted-foreground', borderColor: 'transparent' },
      // .badge--success — bg-brand-1/20, text-brand-1, border-brand-1/30 (alphas via web color-mix)
      success: {
        backgroundColor: 'color-mix(in srgb, var(--brand-1) 20%, transparent)',
        color: '$brand-1',
        borderColor: 'color-mix(in srgb, var(--brand-1) 30%, transparent)',
      },
    },
  } as const,

  defaultVariants: { variant: 'default' },
})

export type BadgeVariant = 'default' | 'primary' | 'muted' | 'success'

export interface StyledBadgeProps extends React.ComponentProps<'span'> {
  variant?: BadgeVariant
}

const Frame = BadgeFrame as unknown as React.ComponentType<any>

/** Idiomatic Badge — same public API as the shipped className Badge (`variant`). */
export function StyledBadge({ variant = 'default', ...props }: StyledBadgeProps) {
  return <Frame variant={variant} {...props} />
}
