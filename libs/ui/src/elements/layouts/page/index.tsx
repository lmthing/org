import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Page — the idiomatic `.page`. Renders `Prim.Box` (real `<div>`s at runtime via `createComponent`)
 * with the styling as `$`-token PROPS from page.styled.tsx (docs/tamagui-idiomatic-migration.md §4).
 * `page/index.css` is deleted; the studio-shell callers that carried `page__body` on a `Prim.Box`
 * now spread `PAGE_BODY` instead.
 */
export interface PageProps extends React.ComponentProps<'div'> {
  full?: boolean
}

/** `.page` base — flex, flex-col, min-h-screen, bg-background. */
const PAGE_BASE = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  backgroundColor: '$background',
} as const

/** `.page--full` — h-screen, overflow-hidden. */
const PAGE_FULL = { height: '100vh', overflow: 'hidden' } as const

/** `.page__header` — flex, items-center, px-6, py-4, border-b. */
export const PAGE_HEADER = {
  display: 'flex',
  alignItems: 'center',
  paddingHorizontal: '$6',
  paddingVertical: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
} as const

/** `.page__body` — flex-1, overflow-auto, p-6. Exported for the shell callers. */
export const PAGE_BODY = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
  padding: '$6',
} as const

function Page({ full, ...props }: PageProps) {
  return (
    <Prim.Box {...PAGE_BASE} {...(full ? PAGE_FULL : {})} {...(props as Record<string, unknown>)} />
  )
}

function PageHeader(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...PAGE_HEADER} {...(props as Record<string, unknown>)} />
}

function PageBody(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...PAGE_BODY} {...(props as Record<string, unknown>)} />
}

export { Page, PageHeader, PageBody }
