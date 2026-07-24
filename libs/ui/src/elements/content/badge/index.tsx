import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Badge — the idiomatic `.badge`. Renders `Prim.Text` (a real `<span>` at runtime via
 * `createComponent`) with the `.badge` styling as `$`-token PROPS from the badge.styled.tsx variant
 * table (docs/tamagui-idiomatic-migration.md §4). `badge/index.css` is deleted; the two former
 * `<a className="badge">` callers became `<Prim.Link>` carrying `BADGE_BASE`.
 */
export type BadgeVariant = 'default' | 'primary' | 'muted' | 'success'

export interface BadgeProps extends React.ComponentProps<'span'> {
  variant?: BadgeVariant
}

// `.badge` base — exported so a non-span badge (e.g. a badge-styled link) can carry the same look.
export const BADGE_BASE = {
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
} as const

export const BADGE_VARIANT: Record<BadgeVariant, Record<string, unknown>> = {
  default: {},
  primary: { backgroundColor: '$primary', color: '$primary-foreground', borderColor: 'transparent' },
  muted: { backgroundColor: '$muted', color: '$muted-foreground', borderColor: 'transparent' },
  success: {
    backgroundColor: 'color-mix(in srgb, var(--brand-1) 20%, transparent)',
    color: '$brand-1',
    borderColor: 'color-mix(in srgb, var(--brand-1) 30%, transparent)',
  },
}

function Badge({ variant = 'default', ...props }: BadgeProps) {
  return (
    <Prim.Text {...(BADGE_BASE as Record<string, unknown>)} {...BADGE_VARIANT[variant]} {...(props as Record<string, unknown>)} />
  )
}

export { Badge }
