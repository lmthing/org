import * as Prim from '../../primitives/index'
import { Home, Sparkles, Users } from '../../primitives/icons'
import { crossAppOrigin, appRoute } from '../../../lib/app-urls'

/**
 * Home / Chat / Teams — the pill row that used to be `AppLinks` linking to Studio/Computer/Team.
 * Those two surfaces don't need a way back to each other from here (each keeps its own switcher,
 * unchanged); this is specifically the THREE a mobile session actually moves between, replacing
 * the app-level bottom tab bar so switching lives in the same drawer as everything else instead of
 * a second, permanently-docked bar.
 *
 * `home` has no `lmthing.home` subdomain of its own (`apps/web/src/routes/home` is a route inside
 * the unified app, not a surface `crossAppOrigin` knows how to resolve) — rather than link it
 * somewhere wrong, it is simply left out on web, where the dashboard is reachable another way.
 * Native has no such route to fall back on, so it needs the entry.
 */
export type Surface = 'home' | 'chat' | 'teams'

export interface SurfaceSwitcherProps {
  /** Which surface is currently showing — drawn active, not a link/press target. */
  current: Surface
  /**
   * Native has no router to hand a URL to: the host supplies this to switch panes in-process.
   * Its presence is also what decides whether `home` renders at all (see above) — passing it is
   * how a caller opts into the native behaviour, not a separate flag to keep in sync.
   */
  onSwitch?: (surface: Surface) => void
  /**
   * Unread counts, by surface. The Teams pane stays mounted while hidden and keeps hearing its
   * channel socket, so without a count here a member who is looking at Home or Chat has no way at
   * all to learn that somebody named them — the bottom bar this replaced carried exactly this.
   */
  badges?: Partial<Record<Surface, number>>
  bordered?: boolean
  className?: string
}

const SURFACE_META: Record<Surface, { label: string; Icon: typeof Home }> = {
  home: { label: 'Home', Icon: Home },
  chat: { label: 'Chat', Icon: Sparkles },
  teams: { label: 'Teams', Icon: Users },
}

const ROW = {
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  display: 'flex',
  // Stated rather than left to the seam's web default — a bare `display:'flex'` is read as `row`
  // by `nativeSafeProps`, which is what this wants, but the pills stack into a column the moment
  // that default changes and nothing would catch it but a device.
  flexDirection: 'row',
  alignItems: 'center',
  gap: '$1',
} as const
const ROW_BORDERED = { borderBottomWidth: 1, borderBottomColor: '$sidebar-border' } as const

/** Mirrors `app-links`' `.app-links__link` pill — equal-width, centred, hovers onto muted/60. */
const PILL = {
  transition: 'quick', animateOnly: ['color', 'background-color', 'border-color'],
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
    backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
    color: '$foreground',
  },
} as const
const PILL_ACTIVE = { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' } as const

/** `teams` maps to the `team` surface/route — plural is the label a member reads, singular is what
 *  `LmthingApp`/`/team` were already named before this switcher existed. */
function surfaceUrl(surface: 'chat' | 'teams'): string {
  const app = surface === 'teams' ? 'team' : 'chat'
  return `${crossAppOrigin(app)}${appRoute(app)}`
}

export function SurfaceSwitcher({ current, onSwitch, badges, bordered, className }: SurfaceSwitcherProps) {
  const surfaces: Surface[] = onSwitch ? ['home', 'chat', 'teams'] : ['chat', 'teams']

  return (
    <Prim.Box {...ROW} {...(bordered ? ROW_BORDERED : {})} className={className}>
      {surfaces.map((s) => {
        const { label, Icon } = SURFACE_META[s]
        const active = s === current
        // A badge on the surface you are already looking at is noise — you can see it.
        const count = active ? 0 : (badges?.[s] ?? 0)
        const body = (
          <>
            <Prim.Box position="relative">
              <Icon size={14} aria-hidden="true" />
              {count > 0 ? <SurfaceBadge count={count} /> : null}
            </Prim.Box>
            <Prim.Text>{label}</Prim.Text>
          </>
        )
        return onSwitch ? (
          <Prim.Pressable
            key={s}
            onClick={() => onSwitch(s)}
            pressStyle={{ opacity: 0.6 }}
            {...PILL}
            {...(active ? PILL_ACTIVE : {})}
          >
            {body}
          </Prim.Pressable>
        ) : (
          <Prim.Link
            key={s}
            href={surfaceUrl(s as 'chat' | 'teams')}
            title={`Open lmthing.${s === 'teams' ? 'team' : s}`}
            {...PILL}
            {...(active ? PILL_ACTIVE : {})}
          >
            {body}
          </Prim.Link>
        )
      })}
    </Prim.Box>
  )
}

/** Capped so a busy team cannot widen the pill it sits in — same treatment as the tab bar's. */
function SurfaceBadge({ count }: { count: number }) {
  return (
    <Prim.Text
      position="absolute"
      top={-6}
      left={8}
      minWidth={15}
      height={15}
      paddingHorizontal="$1"
      borderRadius="$radius-full"
      backgroundColor="$primary"
      color="$primary-foreground"
      fontSize={9}
      fontWeight="$semibold"
      textAlign="center"
      lineHeight={15}
    >
      {count > 99 ? '99+' : String(count)}
    </Prim.Text>
  )
}
