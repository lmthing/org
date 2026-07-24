/**
 * app-links.styled.tsx — P2 composite conversion of the `.app-links` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/app-links/index.css —
 * the `.app-links` row + `.app-links--bordered` and the `.app-links__link` pill — into idiomatic
 * Tamagui `styled()` frames.
 *
 * `transition-colors` awaits the animation driver (§5/P4). Lands alongside the shipped className
 * AppLinks (index.tsx); app-links-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View, Text } from '../../../theme/tamagui-web.config'
import { otherAppLinks, type LmthingApp } from '../../../lib/app-urls'

/** `.app-links` — px-3, py-2, flex, items-center, gap-1 + the `bordered` variant (border-b, sidebar-border). */
export const AppLinksFrame = styled(View, {
  name: 'AppLinks',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',

  variants: {
    bordered: {
      true: { borderBottomWidth: 1, borderBottomColor: '$sidebar-border' },
    },
  } as const,
})

/**
 * `.app-links__link` — flex-1, flex, items-center, justify-center, gap-1.5, px-2, py-1.5, rounded-lg,
 * text-xs, text-muted-foreground, hover:bg-muted/60, hover:text-foreground.
 */
export const AppLinksLinkFrame = styled(Text, {
  name: 'AppLinksLink',
  tag: 'a',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$1.5',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  borderRadius: '$radius-lg',
  fontSize: '$xs',
  color: '$muted-foreground',
  hoverStyle: {
    backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', // hover:bg-muted/60
    color: '$foreground',
  },
})

export interface StyledAppLinksProps {
  current: LmthingApp
  bordered?: boolean
}

const Frame = AppLinksFrame as unknown as React.ComponentType<any>
const Link = AppLinksLinkFrame as unknown as React.ComponentType<any>

/** Idiomatic AppLinks — same behaviour as the shipped className AppLinks (the `otherAppLinks` pill row). */
export function StyledAppLinks({ current, bordered }: StyledAppLinksProps) {
  return (
    <Frame bordered={bordered}>
      {otherAppLinks(current).map((link) => (
        <Link key={link.app} href={link.url} title={`Open lmthing.${link.app}`}>
          <span aria-hidden="true">{link.emoji}</span>
          {link.label}
        </Link>
      ))}
    </Frame>
  )
}
