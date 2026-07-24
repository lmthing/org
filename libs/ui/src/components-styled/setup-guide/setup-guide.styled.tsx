/** setup-guide.styled.tsx — P2 conversion of the `.lm-setup-guide` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className guide.
 *  The `<details>` disclosure caret is a real marker element (the `::before` content) — see below. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.lm-setup-guide` — a bordered, clipped `<details>` wrapper on the muted surface. */
export const SetupGuideFrame = styled(View, {
  name: 'SetupGuide',
  borderColor: '$border',
  backgroundColor: '$muted',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: '$radius-lg',
  overflow: 'hidden',
})

/** `.lm-setup-guide__summary` — the clickable `<summary>` heading (0.85rem ≈ 13.6px, no scale token;
 *  0.6rem/0.85rem padding likewise off-scale → literal px). The `::-webkit-details-marker { display:none }`
 *  rule is a browser-native pseudo with no styled() equivalent; the default marker is instead replaced
 *  by the explicit caret marker element below. */
export const SetupGuideSummaryFrame = styled(View, {
  name: 'SetupGuideSummary',
  color: '$foreground',
  cursor: 'pointer',
  fontSize: 13.6,
  fontWeight: '$semibold',
  paddingVertical: 9.6,
  paddingHorizontal: 13.6,
  listStyleType: 'none',
  userSelect: 'none',
})

/** The `.lm-setup-guide__summary::before` caret (content '▸'), rendered as a real element.
 *  The `open` variant rotates it 90° (the `.lm-setup-guide[open] … ::before { transform: rotate(90deg) }`
 *  rule); `transition: transform 0.15s ease` awaits the animation driver (§5/P4). */
export const SetupGuideSummaryMarkerFrame = styled(Text, {
  name: 'SetupGuideSummaryMarker',
  display: 'inline-block',
  marginRight: '$2',

  variants: {
    open: {
      true: { rotate: '90deg' },
    },
  } as const,
})

/** `.lm-setup-guide__body` — the README body on the background surface with a top divider. */
export const SetupGuideBodyFrame = styled(View, {
  name: 'SetupGuideBody',
  backgroundColor: '$background',
  borderColor: '$border',
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  paddingVertical: 13.6,
  paddingHorizontal: '$4',
})

export interface StyledSetupGuideProps extends React.ComponentProps<'div'> {
  /** Mirrors the native `<details open>` state that drives the caret rotation. */
  open?: boolean
  summary?: React.ReactNode
}

const Frame = SetupGuideFrame as unknown as React.ComponentType<any>
const Summary = SetupGuideSummaryFrame as unknown as React.ComponentType<any>
const Marker = SetupGuideSummaryMarkerFrame as unknown as React.ComponentType<any>

/** Idiomatic SetupGuide — same public API as the shipped className `<details>` guide (`open`).
 *  Renders the summary heading with its caret marker element, then the body children. */
export function StyledSetupGuide({ open, summary, children, ...props }: StyledSetupGuideProps) {
  return (
    <Frame {...props}>
      <Summary>
        <Marker open={open}>▸</Marker>
        {summary}
      </Summary>
      {children}
    </Frame>
  )
}
