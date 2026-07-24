/**
 * page.styled.tsx — P2 composite conversion of the `.page` BEM block
 * (docs/tamagui-idiomatic-migration.md §4, the "then the composite BEM" step). Converts
 * libs/css/src/elements/layouts/page/index.css — the `.page` base + `.page--full` and the
 * `.page__header`/`__body` parts — into idiomatic Tamagui `styled()` frames.
 *
 * Lands alongside the shipped className Page (index.tsx); page-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/** `.page` base (flex, flex-col, min-h-screen, bg-background) + the `full` variant (h-screen, overflow-hidden). */
export const PageFrame = styled(View, {
  name: 'Page',
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh', // min-h-screen
  backgroundColor: '$background',

  variants: {
    full: {
      true: { height: '100vh', overflow: 'hidden' },
    },
  } as const,
})

/** `.page__header` — flex, items-center, px-6, py-4, border-b, border-border. */
export const PageHeaderFrame = styled(View, {
  name: 'PageHeader',
  display: 'flex',
  alignItems: 'center',
  paddingHorizontal: '$6',
  paddingVertical: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.page__body` — flex-1, overflow-auto, p-6. */
export const PageBodyFrame = styled(View, {
  name: 'PageBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
  padding: '$6',
})

export interface StyledPageProps extends React.ComponentProps<'div'> {
  full?: boolean
}

const Frame = PageFrame as unknown as React.ComponentType<any>
const Header = PageHeaderFrame as unknown as React.ComponentType<any>
const Body = PageBodyFrame as unknown as React.ComponentType<any>

/** Idiomatic Page family — same public API as the shipped className Page (`full`). */
export function StyledPage({ full, ...props }: StyledPageProps) {
  return <Frame full={full} {...props} />
}
export const StyledPageHeader = (props: React.ComponentProps<'div'>) => <Header {...props} />
export const StyledPageBody = (props: React.ComponentProps<'div'>) => <Body {...props} />
