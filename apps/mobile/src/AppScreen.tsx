import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { AppView } from '@lmthing/ui/elements/content/app-view'


import { appUrl } from './hosts'

/**
 * A project's app, full screen.
 *
 * The team surface opens an app in a rail beside the conversation, because there is a conversation
 * to sit beside. A PERSONAL project has no such context — you are opening the app itself — so on a
 * phone it takes the whole screen, with a way back.
 *
 * Until this existed a personal app could not be looked at on a phone AT ALL: `DashboardHome` has
 * always taken an `onOpenProject`, and this app never passed one, so tapping a project on Home did
 * nothing. The web app reaches the same pages through a route; native has no router, so the host
 * owns the state, exactly as it does for the team rail.
 */
export function AppScreen({ projectId, name, onClose }: { projectId: string; name: string; onClose: () => void }) {
  return (
    <Prim.Col flex={1} minHeight={0}>
      <Prim.Row
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderColor="$border"
        flexShrink={0}
      >
        <Prim.Text fontSize="$sm" fontWeight="$semibold" flex={1} minWidth={0}>
          {name}
        </Prim.Text>
        <Prim.Pressable onClick={onClose} aria-label="Close app" padding="$1">
          {/*
            Drawn from the SVG primitives rather than taken from `elements/primitives/icons`.
            That barrel re-exports `@tamagui/lucide-icons-2`, which is DECLARED in `libs/ui`'s
            package.json and not installed — so on a device the import yields `undefined` and React
            Native fails with "View config getter callback for component `path`". The team surface
            draws its icons this way for the same reason.
          */}
          <Prim.Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <Prim.Path d="M18 6 6 18" />
            <Prim.Path d="m6 6 12 12" />
          </Prim.Svg>
        </Prim.Pressable>
      </Prim.Row>
      <AppView url={appUrl(projectId)} title={name} />
    </Prim.Col>
  )
}
