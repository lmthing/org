import * as React from 'react'
import { styled, View } from '@tamagui/core'
import './eq-tamagui.config'

/**
 * B1 EQUIVALENCE fixtures (Part III / §4 pre-proof).
 *
 * Before the shared web primitives are swapped to Tamagui, prove — in the SAME page, independent
 * of any committed `main` baseline — that a Tamagui `styled(View)` with the block-compat resets
 * computes the same box model as the plain-HTML element it will replace:
 *   - <Row>  ≡  <div style="display:flex;flex-direction:row">
 *   - <Col>  ≡  <div style="display:flex;flex-direction:column">
 *   - <Box>  ≡  <div>            (block container)
 *
 * Each fixture renders a `[data-eq-ref]` plain element next to a `[data-eq-cand]` Tamagui element
 * with IDENTICAL children; `equivalence.spec.ts` asserts equal computed styles on the audited set,
 * with two documented semantic-equivalence normalizations (see that spec). These `styled()`
 * definitions are exactly what the real `row/col/box` `index.tsx` will export at B1's swap.
 *
 * The block-compat resets exist because Tamagui's RN `View` base (`.is_View`) forces the RN box
 * model (flex, column, align-items:stretch, flex-shrink:0, min:0). On WEB we override the ones that
 * differ from a browser `<div>` so the web output matches; the `*.native.tsx` forks keep the RN
 * defaults. See docs/react-native-tamagui-migration.md Part III / §1 table / §4.
 */

// Shared web block-compat resets: a browser flex/block box, not the RN one.
const webBlockCompat = {
  // A `<div>` flex child (or standalone) shrinks; RN base forces 0.
  flexShrink: 1,
  // A `<div>`'s min-width/height is `auto`; RN base forces 0.
  minWidth: 'auto',
  minHeight: 'auto',
} as const

/** Row ≡ `<div style="display:flex;flex-direction:row">`. */
export const CandRow = styled(View, {
  name: 'Row',
  flexDirection: 'row',
  ...webBlockCompat,
})

/** Col ≡ `<div style="display:flex;flex-direction:column">`. */
export const CandCol = styled(View, {
  name: 'Col',
  flexDirection: 'column',
  ...webBlockCompat,
})

/** Box ≡ a block `<div>`. `display:'block'` overrides the RN flex base. */
export const CandBox = styled(View, {
  name: 'Box',
  display: 'block',
  ...webBlockCompat,
})

export type EqFixture = { name: string; ref: () => React.ReactNode; cand: () => React.ReactNode }

const rowRef: React.CSSProperties = { display: 'flex', flexDirection: 'row' }
const colRef: React.CSSProperties = { display: 'flex', flexDirection: 'column' }

export const eqFixtures: EqFixture[] = [
  {
    name: 'eq-row',
    ref: () => (
      <div data-eq-ref style={rowRef}>
        <span>a</span>
        <span>b</span>
      </div>
    ),
    cand: () => (
      <CandRow data-eq-cand>
        <span>a</span>
        <span>b</span>
      </CandRow>
    ),
  },
  {
    name: 'eq-col',
    ref: () => (
      <div data-eq-ref style={colRef}>
        <span>a</span>
        <span>b</span>
      </div>
    ),
    cand: () => (
      <CandCol data-eq-cand>
        <span>a</span>
        <span>b</span>
      </CandCol>
    ),
  },
  {
    name: 'eq-box',
    ref: () => (
      <div data-eq-ref>
        <span>a</span>
      </div>
    ),
    cand: () => (
      <CandBox data-eq-cand>
        <span>a</span>
      </CandBox>
    ),
  },
]
