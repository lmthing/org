/**
 * Layout prediction — the SHELL half. The spec replacement for the `_app.tsx` /
 * `_layout.tsx` every catalogue app hand-writes.
 *
 * ## The derivation rule, and the measurement behind it
 *
 * The renderer derives nav from the route list **only when there are at most
 * {@link SHELL_DERIVE_MAX_ROUTES} top-level STATIC routes**. Above that the model must
 * declare `groups`.
 *
 * That threshold is not taste. T0 measured **0 of 5 catalogue apps reproducing** from a
 * flat route list: four of the five hand-group 13–21 routes into 4–6 destinations, and a
 * flat mapping produces an unusable 13–21-item bottom bar on a phone. Deriving anyway
 * would put the shell's own layout-override rate at ~80%, which by the plan's own metric
 * means the PREDICTION is wrong, not that the model is over-specifying. So above the
 * threshold this returns no nav and says why — and `validateAppViews` is what turns that
 * into a build error rather than a silent dead end.
 *
 * **A parameterised route is never a nav item.** `/searches/[id]/compare`,
 * `/feed/[articleId]`, `/documents/[docId]` are drill-ins, not destinations; a derived
 * shell that lists them produces nonsense. They reach the user through a `rowAction`, a
 * `navigate`, or a {@link SubnavSpec}.
 *
 * ## Placement
 *
 * `auto` is target-predicted: **bottom tabs on a phone** (the thumb is already there, and
 * four equal columns always fit a 390px viewport — the team surface learned this the hard
 * way), a **top bar** on a wide screen with few destinations, a **sidebar** when there are
 * more than four. All three are one component tree with media-driven visibility, so there
 * is no branch on the platform anywhere in this file.
 *
 * ## Subnav
 *
 * T0's largest un-designed area: `TripTabs` is 15 tabs in 3 groups under
 * `trips/[tripId]/*`. Declared ONCE per route family; the current route's parameter values
 * carry into every item, so an item is written once as `trips/[tripId]/expenses` — not
 * once per trip and not once per page. Without it a spec app's per-entity pages **cannot
 * reach each other at all**.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import type { NavBadge, NavEntry, NavGroup, Route, ShellPlacement, ShellSpec, SubnavSpec } from './types'
import { SHELL_DERIVE_MAX_ROUTES } from './types'
import { fillRoute, resolveBinding, routeParams } from './bind'
import { humanize, stringify } from './format'
import { useViewQuery, useViewRuntime } from './runtime'
import { ViewIcon } from './icons'
import { ChatSectionView } from './sections/chat'

/** One resolved destination — the shape both the tab bar and the sidebar draw. */
export interface NavDestination {
  key: string
  label: string
  /** The route the destination opens. */
  home: Route
  /** Every route that keeps it highlighted (a group's family). */
  family: Route[]
  icon?: string
  badge?: NavBadge
}

/** What {@link deriveNav} decided, plus why — so a validator can report on it. */
export interface NavDecision {
  destinations: NavDestination[]
  /** `'declared'` | `'derived'` | `'undecidable'`. */
  source: 'declared-groups' | 'declared-nav' | 'derived' | 'undecidable'
  reason: string
}

/** A route with no `[param]` segment — the only kind that may be a nav destination. */
export function isStaticRoute(route: string): boolean {
  return !route.includes('[')
}

/** The top-level segment of a route (`recipes/new` ⇒ `recipes`). */
export function topLevel(route: string): string {
  return route.split('/')[0] ?? route
}

/**
 * Decide the app's destinations.
 *
 * Declared always wins: `groups` first (the honest declaration above the threshold), then
 * a flat `nav`, then derivation, then the undecidable case.
 */
export function deriveNav(shell: ShellSpec | undefined, routes: Route[]): NavDecision {
  if (shell?.groups?.length) {
    return {
      source: 'declared-groups',
      reason: 'the spec declared groups',
      destinations: shell.groups.map((group: NavGroup) => ({
        key: group.home,
        label: stringify(group.label),
        home: group.home,
        family: [group.home, ...(group.routes ?? [])],
        icon: group.icon,
        badge: group.badge,
      })),
    }
  }

  if (shell?.nav?.length) {
    return {
      source: 'declared-nav',
      reason: 'the spec declared a flat nav',
      destinations: shell.nav.map((entry: NavEntry) => ({
        key: entry.route,
        label: stringify(entry.label ?? labelFor(entry.route)),
        home: entry.route,
        family: [entry.route],
        icon: entry.icon,
        badge: entry.badge,
      })),
    }
  }

  // Derivation: top-level STATIC routes only, deduplicated by their first segment, with
  // `index` first because it is the app's front door.
  const tops = new Map<string, Route>()
  for (const route of routes) {
    if (!isStaticRoute(route)) continue
    const top = topLevel(route)
    const existing = tops.get(top)
    if (!existing || route.length < existing.length) tops.set(top, route)
  }
  const ordered = [...tops.entries()].sort(([a], [b]) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)))

  if (ordered.length > SHELL_DERIVE_MAX_ROUTES) {
    return {
      source: 'undecidable',
      reason:
        `${ordered.length} top-level static routes exceeds SHELL_DERIVE_MAX_ROUTES (${SHELL_DERIVE_MAX_ROUTES}); ` +
        'the spec must declare shell.groups — a flat bar of this many destinations is unusable on a phone',
      destinations: [],
    }
  }

  return {
    source: 'derived',
    reason: `${ordered.length} top-level static routes`,
    destinations: ordered.map(([top, route]) => ({
      key: route,
      label: labelFor(top),
      home: route,
      family: routes.filter((r) => isStaticRoute(r) && topLevel(r) === top),
      icon: iconFor(top),
    })),
  }
}

function labelFor(route: string): string {
  const top = topLevel(route)
  return top === 'index' ? 'Home' : humanize(top)
}

/** A best-effort icon from the destination's name. Purely decorative; never load-bearing. */
function iconFor(top: string): string | undefined {
  const table: Record<string, string> = {
    index: 'home',
    home: 'home',
    search: 'search',
    searches: 'search',
    settings: 'settings',
    preferences: 'settings',
    calendar: 'calendar',
    schedule: 'calendar',
    people: 'users',
    members: 'users',
    travelers: 'users',
    documents: 'file',
    files: 'file',
    alerts: 'bell',
    notifications: 'bell',
    inbox: 'mail',
    stats: 'chart',
    reports: 'chart',
    dashboard: 'chart',
  }
  return table[top]
}

/**
 * Does a live route match one family member? Segment SHAPE comparison, same length.
 *
 * A family member may be parameterised (Wave-2): `trip/[planId]` is a drill-in that belongs
 * to the Shop tab, and it reaches the user as `trip/p7`. A string compare would never
 * highlight it, which is what made drill-ins look like they belong to no tab.
 */
export function routeShapeMatches(member: Route, route: string): boolean {
  const m = member.split('/')
  const r = route.split('/')
  if (m.length !== r.length) return false
  return m.every((seg, i) => (seg.startsWith('[') ? r[i] !== undefined && r[i] !== '' : seg === r[i]))
}

/** Which destination the current route belongs to. */
export function activeDestination(destinations: NavDestination[], route: string): string | undefined {
  const top = topLevel(route)
  // The family first, by shape — an exact static member and a parameterised drill-in are
  // the same question asked of two spellings.
  const exact = destinations.find((d) => d.family.some((member) => routeShapeMatches(member, route)))
  if (exact) return exact.key
  const byTop = destinations.find((d) => d.family.some((r) => topLevel(r) === top))
  return byTop?.key
}

/**
 * The subnav that applies to the current route, with the route's own parameter values
 * carried into every item.
 *
 * `match` is a parameterised prefix (`trips/[tripId]`); a page whose route starts with it
 * — comparing SEGMENT SHAPES, so `[tripId]` matches whatever is in that slot — gets the
 * bar.
 */
export function subnavFor(
  shell: ShellSpec | undefined,
  routePath: string,
  params: Record<string, string>,
  routes: Route[] = [],
): { spec: SubnavSpec; items: { label: string; route: string; icon?: string; badge?: NavBadge }[] } | undefined {
  for (const spec of shell?.subnav ?? []) {
    if (!matchesPrefix(spec.match, routePath)) continue
    if (capturesAStaticSibling(spec.match, routePath, routes)) continue
    const entries: NavEntry[] = spec.groups?.length
      ? spec.groups.flatMap((group) => group.items)
      : (spec.items ?? [])
    return {
      spec,
      items: entries.map((entry) => ({
        label: stringify(entry.label ?? labelFor(entry.route.split('/').filter((s) => !s.startsWith('[')).pop() ?? entry.route)),
        route: fillRoute(entry.route, params),
        icon: entry.icon,
        badge: entry.badge,
      })),
    }
  }
  return undefined
}

/** Does `route` sit under the parameterised prefix `match`? Segment-shape comparison. */
export function matchesPrefix(match: string, route: string): boolean {
  const m = match.split('/')
  const r = route.split('/')
  if (r.length < m.length) return false
  return m.every((seg, i) => (seg.startsWith('[') ? r[i] !== undefined && r[i] !== '' : seg === r[i]))
}

/**
 * **A static route always beats a parameter** — the rule {@link matchesPrefix} alone cannot apply.
 *
 * `matchesPrefix` compares segment SHAPES, so `plants/[id]` matches `plants/new` just as happily as
 * `plants/p1`: `[id]` accepts any non-empty segment, and `new` is non-empty. Seen live on the
 * emulator — the `plants/new` page drew the *detail* page's subnav, whose "Details" pill navigated
 * to the literal path `plants/[id]` with no params, landing on a page whose every query was
 * unresolvable. `apps/mobile/src/app-views.ts#resolveRoute` already encodes this rule for route
 * RESOLUTION; the shell's prefix match had no equivalent.
 *
 * Deciding it needs the app's route list, which is why `subnavFor` takes one: if the prefix that
 * `match` would consume is ITSELF a declared route with no parameters of its own, that route owns
 * the path and the parameter must not capture it. `plants/new` is declared, so `plants/[id]` yields;
 * `plants/p1` is not, so it captures as intended. With no routes supplied nothing is suppressed —
 * the caller that knows the app passes them.
 */
function capturesAStaticSibling(match: string, routePath: string, routes: Route[]): boolean {
  const m = match.split('/')
  if (!m.some((seg) => seg.startsWith('['))) return false // nothing was captured
  const prefix = routePath.split('/').slice(0, m.length).join('/')
  return routes.some((r) => r === prefix && !r.includes('['))
}

/** Fill a subnav's item routes from the current route's parameter values. */
export function paramsFromRoute(match: string, routePath: string): Record<string, string> {
  const names = routeParams(match)
  const m = match.split('/')
  const r = routePath.split('/')
  const out: Record<string, string> = {}
  let n = 0
  m.forEach((seg, i) => {
    if (seg.startsWith('[')) out[names[n++]] = r[i] ?? ''
  })
  return out
}

// ── rendering ────────────────────────────────────────────────────────────────

/** A nav badge — one small query per destination that declares one. */
function BadgeCount({ badge }: { badge: NavBadge }) {
  const query = useViewQuery({ name: badge.query })
  const value = resolveBinding(badge.field, { self: query.data })
  const n = Number(value)
  // Not cosmetic: these apps run on background agents, and the badge IS the
  // "something needs you" signal they produce. A zero draws nothing.
  if (!Number.isFinite(n) || n <= 0) return null
  return (
    <Prim.Box
      minWidth={18}
      height={18}
      paddingHorizontal="$1"
      borderRadius="$radius-full"
      backgroundColor="$primary"
      alignItems="center"
      justifyContent="center"
    >
      <Prim.Text fontSize="$xs" fontWeight="$semibold" color="$primary-foreground">
        {n > 99 ? '99+' : String(n)}
      </Prim.Text>
    </Prim.Box>
  )
}

function NavItem({
  destination,
  active,
  onPress,
  orientation,
}: {
  destination: NavDestination
  active: boolean
  onPress: () => void
  orientation: 'tab' | 'row'
}) {
  const column = orientation === 'tab'
  return (
    <Prim.Pressable
      onClick={onPress}
      display="flex"
      flexDirection={column ? 'column' : 'row'}
      alignItems="center"
      justifyContent="center"
      gap={column ? '$1' : '$2'}
      {...(column
        ? { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minHeight: 48, paddingVertical: '$2' }
        : { paddingHorizontal: '$3', paddingVertical: '$2', borderRadius: '$radius-md' })}
      backgroundColor={!column && active ? '$accent' : 'transparent'}
      aria-current={active ? 'page' : undefined}
    >
      <Prim.Row alignItems="center" gap="$1.5">
        {destination.icon ? (
          <ViewIcon name={destination.icon} size="md" color={active ? '$primary' : '$muted-foreground'} />
        ) : null}
        {destination.badge ? <BadgeCount badge={destination.badge} /> : null}
      </Prim.Row>
      <Prim.Text
        fontSize="$xs"
        fontWeight={active ? '$semibold' : '$medium'}
        color={active ? '$primary' : '$muted-foreground'}
      >
        {destination.label}
      </Prim.Text>
    </Prim.Pressable>
  )
}

export interface ViewShellProps {
  shell?: ShellSpec
  /** Every route the app has — the derivation input. */
  routes?: Route[]
  children: React.ReactNode
}

/**
 * The app frame: brand, navigation, the current page, the assistant dock.
 *
 * Placement is chosen by MEDIA, not by platform: the bottom bar is hidden from `$sm` up
 * and the top bar / sidebar below it, so one tree serves a phone and a desktop and the
 * native target gets the phone arrangement for free.
 */
export function ViewShell({ shell, routes = [], children }: ViewShellProps): React.ReactElement {
  const { client, routePath, routeParams } = useViewRuntime()
  const nav = React.useMemo(() => deriveNav(shell, routes), [shell, routes])
  const active = activeDestination(nav.destinations, routePath)
  // `routes` is threaded so a parameterised subnav cannot capture a static sibling — see
  // `capturesAStaticSibling`. Without it, `plants/new` drew the detail page's bar.
  const sub = React.useMemo(
    () => subnavFor(shell, routePath, routeParams, routes),
    [shell, routePath, routeParams, routes],
  )
  const [assistantOpen, setAssistantOpen] = React.useState(false)

  const placement: ShellPlacement = shell?.placement ?? 'auto'
  const wideAsSidebar = placement === 'sidebar' || (placement === 'auto' && nav.destinations.length > 4)
  const go = (route: Route) => client.navigate?.(route)

  const topBar =
    nav.destinations.length > 0 && !wideAsSidebar ? (
      <Prim.Row
        display="none"
        $sm={{ display: 'flex' }}
        gap="$2"
        alignItems="center"
        paddingHorizontal="$4"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderColor="$border"
        backgroundColor="$card"
      >
        {shell?.brand ? (
          <Prim.Text fontSize="$base" fontWeight="$semibold" color="$foreground" marginRight="$4">
            {shell.brand}
          </Prim.Text>
        ) : null}
        {nav.destinations.map((d) => (
          <NavItem key={d.key} destination={d} active={d.key === active} onPress={() => go(d.home)} orientation="row" />
        ))}
      </Prim.Row>
    ) : null

  const sidebar =
    nav.destinations.length > 0 && wideAsSidebar ? (
      <Prim.Col
        display="none"
        $sm={{ display: 'flex' }}
        width={220}
        flexShrink={0}
        gap="$1"
        padding="$3"
        borderRightWidth={1}
        borderColor="$border"
        backgroundColor="$sidebar"
      >
        {shell?.brand ? (
          <Prim.Text fontSize="$base" fontWeight="$semibold" color="$foreground" marginBottom="$3">
            {shell.brand}
          </Prim.Text>
        ) : null}
        {nav.destinations.map((d) => (
          <NavItem key={d.key} destination={d} active={d.key === active} onPress={() => go(d.home)} orientation="row" />
        ))}
      </Prim.Col>
    ) : null

  const bottomTabs =
    nav.destinations.length > 0 ? (
      <Prim.Row
        display="flex"
        $sm={{ display: 'none' }}
        alignItems="stretch"
        flexShrink={0}
        borderTopWidth={1}
        borderColor="$border"
        backgroundColor="$card"
      >
        {nav.destinations.slice(0, 5).map((d) => (
          <NavItem key={d.key} destination={d} active={d.key === active} onPress={() => go(d.home)} orientation="tab" />
        ))}
      </Prim.Row>
    ) : null

  const subnav = sub ? (
    <Prim.Box borderBottomWidth={1} borderColor="$border" backgroundColor="$background">
      <Prim.Scroll maxHeight={56}>
        <Prim.Row gap="$1" paddingHorizontal="$3" paddingVertical="$2" flexWrap="nowrap">
          {sub.items.map((item) => {
            const isActive = routePath === item.route
            return (
              <Prim.Pressable
                key={item.route}
                onClick={() => go(item.route)}
                paddingHorizontal="$3"
                paddingVertical="$1.5"
                borderRadius="$radius-full"
                backgroundColor={isActive ? '$primary' : '$secondary'}
              >
                <Prim.Text
                  fontSize="$xs"
                  fontWeight="$medium"
                  color={isActive ? '$primary-foreground' : '$secondary-foreground'}
                >
                  {item.label}
                </Prim.Text>
              </Prim.Pressable>
            )
          })}
        </Prim.Row>
      </Prim.Scroll>
    </Prim.Box>
  ) : null

  return (
    /**
     * `height="100%"` is LOAD-BEARING, and `flexGrow` cannot replace it.
     *
     * The web mount point is a plain `<div>` (`display: block`) under a couple of
     * `display: contents` theme wrappers, and a block box is NOT a flex container — so
     * `flexGrow: 1` here has nothing to grow inside and this Col sizes to its CONTENT. Measured
     * live on the first model-built app: 98px, exactly the top bar (56) + the assistant strip (42).
     * Every descendant then divided zero: the Row 0, the inner Col 0, and the scroller
     * `clientHeight: 0` around 719px of content, which put the first list row's buttons at
     * `y: -107` — off-screen and unclickable.
     *
     * The failure is invisible to every gate we have. `buildApp` compiles, `validateAppViews`
     * resolves every name, `renderSmokeViews` mounts and every binding is non-null, and the a11y
     * tree lists all the content because the DOM nodes genuinely exist — they are just 0px tall.
     * Only a screenshot showed the app was blank. jsdom cannot catch it either (no layout engine),
     * which is why the test below asserts the DECLARATION rather than the geometry.
     *
     * `100%` rather than `100dvh`: the root div is already sized to the viewport, so inheriting
     * from it keeps one source of truth and survives being mounted inside something smaller.
     */
    <Prim.Col height="100%" flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} backgroundColor="$background">
      {topBar}
      <Prim.Row flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} alignItems="stretch">
        {sidebar}
        <Prim.Col flexGrow={1} flexShrink={1} flexBasis="0%" minHeight={0}>
          {subnav}
          <Prim.Scroll flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0}>{children}</Prim.Scroll>
        </Prim.Col>
      </Prim.Row>

      {shell?.assistant ? (
        <Prim.Col borderTopWidth={1} borderColor="$border" backgroundColor="$card">
          <Prim.Pressable
            onClick={() => setAssistantOpen((o) => !o)}
            display="flex"
            flexDirection="row"
            alignItems="center"
            gap="$2"
            paddingHorizontal="$4"
            paddingVertical="$2"
          >
            <ViewIcon name={assistantOpen ? 'chevron-down' : 'chevron-right'} size="sm" />
            <Prim.Text fontSize="$sm" fontWeight="$medium">
              Assistant
            </Prim.Text>
          </Prim.Pressable>
          {assistantOpen ? (
            <Prim.Box paddingHorizontal="$4" paddingBottom="$4">
              <ChatSectionView
                section={{
                  kind: 'chat',
                  agent: shell.assistant.agent,
                  space: shell.assistant.space,
                  greeting: shell.assistant.greeting,
                  height: 'md',
                }}
                scope={{}}
              />
            </Prim.Box>
          ) : null}
        </Prim.Col>
      ) : null}

      {bottomTabs}
    </Prim.Col>
  )
}
