import * as Prim from '../../primitives/index'
import { otherAppLinks, type LmthingApp } from '../../../lib/app-urls'

/**
 * Horizontal pill row linking to the *other* lmthing surfaces, used in the
 * chat + studio sidebar footers. Uses {@link otherAppLinks} so local vs
 * production origins are resolved consistently.
 *
 * The idiomatic `.app-links`: styling is `$`-token PROPS from app-links.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4); `app-links/index.css` is deleted. The
 * `.app-links--bordered` modifier — which no caller passed via className — is now the
 * `bordered` prop. (`transition-colors` awaits the animation driver, §5/P4.)
 */
export interface AppLinksProps {
  /** The current surface — its own link is omitted from the row. */
  current: LmthingApp
  /** Bottom divider (the chat footer stacks project settings underneath). */
  bordered?: boolean
  className?: string
}

/** `.app-links` — px-3, py-2, flex, items-center, gap-1. */
const APP_LINKS = {
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
} as const

/** `.app-links--bordered` — border-b, border-sidebar-border. */
const APP_LINKS_BORDERED = { borderBottomWidth: 1, borderBottomColor: '$sidebar-border' } as const

/** `.app-links__link` — an equal-width centred pill that hovers onto muted/60. */
const APP_LINK = {
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
} as const

export function AppLinks({ current, bordered, className }: AppLinksProps) {
  return (
    <Prim.Box {...APP_LINKS} {...(bordered ? APP_LINKS_BORDERED : {})} className={className}>
      {otherAppLinks(current).map((link) => (
        <Prim.Link
          key={link.app}
          href={link.url}
          title={`Open lmthing.${link.app}`}
          {...APP_LINK}
        >
          <Prim.Text aria-hidden="true">{link.emoji}</Prim.Text>
          {link.label}
        </Prim.Link>
      ))}
    </Prim.Box>
  )
}
