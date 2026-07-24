import * as React from 'react'
import {
  Link,
  List,
  ListItem,
} from '../../../libs/ui/src/elements/primitives/index'

// NOTE: Row/Col (B2), Text (B3.1), Pressable (B3.2) AND Box (B3.3) are now real Tamagui primitives. Their
// box-model / text-flow parity is proven where it can be proven FAITHFULLY — under the real theme.css
// + Tailwind PREFLIGHT (which resets box-sizing/margins/the button UA styling), i.e. the
// apps/web/b0-probe slices (surface + text-variants + pressable-variants) and the eq-fixtures. This
// self-contained harness has NO preflight, so a real Tamagui primitive rendered bare here would diff
// from a raw tag on preflight-owned props (box-sizing, heading margins, button border/appearance) —
// noise that never occurs in production. So the bare fixtures below keep using still-passthrough
// primitives (Box + the fx-row/fx-col classes; local `PassText`/`PassPressable`), which KEEP their
// `main` baselines byte-valid. The real Tamagui proofs live in b0-probe/{text,pressable}-variants.

/**
 * Local passthrough copies of the PRE-swap `Text`/`Pressable` primitives (render the raw tag with
 * props verbatim), used only by the bare fixtures so their passthrough `main` baselines stay valid now
 * that the real primitives are Tamagui. Same rationale as the Row/Col → `Box` swap above.
 */
const PassText = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { as?: string; block?: boolean }
>(({ as, block, ...props }, ref) =>
  React.createElement((as ?? (block ? 'p' : 'span')) as string, { ...props, ref }),
)
PassText.displayName = 'PassText'
const Text = PassText

const PassPressable = React.forwardRef<
  HTMLElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: string; href?: string }
>(({ as, ...props }, ref) => React.createElement((as ?? 'button') as string, { ...props, ref }))
PassPressable.displayName = 'PassPressable'
const Pressable = PassPressable

const PassBox = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { as?: string; open?: boolean }
>(({ as, ...props }, ref) => React.createElement((as ?? 'div') as string, { ...props, ref }))
PassBox.displayName = 'PassBox'
const Box = PassBox

/**
 * Frozen fixtures for the visual/computed-style harness (§3.1).
 *
 * Each fixture renders the Phase-0/1 primitives in a representative shape. They deliberately
 * exercise the box-model swap risk (§1 table): bare primitives (block-default `<div>` vs the
 * Tamagui `<Block>` flex-with-resets), explicit flex rows/cols, inline styles, and a nested
 * composite. The harness renders the SAME fixtures against the passthrough baseline and the
 * Tamagui candidate; the only variable is the primitive implementation.
 *
 * Styling uses inline styles + a small hand-written harness.css (token-based) — NOT Tailwind —
 * so the harness is self-contained. The parity contract under test is the primitives' own
 * default box model and their passthrough of className/style, which is exactly the swap risk.
 */
export type Fixture = { name: string; render: () => React.ReactNode }

export const fixtures: Fixture[] = [
  {
    name: 'box-bare',
    render: () => <Box className="fx-swatch">bare box</Box>,
  },
  {
    name: 'box-as-section',
    render: () => (
      <Box as="section" className="fx-card">
        <Text as="h3" className="fx-title">
          Section
        </Text>
        <Text block>A block of body text inside a semantic section container.</Text>
      </Box>
    ),
  },
  {
    name: 'text-inline-variants',
    render: () => (
      <Box className="fx-swatch">
        <Text>plain span </Text>
        <Text as="strong">strong </Text>
        <Text as="em">em </Text>
        <Text as="small">small </Text>
        <Text as="code" className="fx-code">
          code
        </Text>
      </Box>
    ),
  },
  {
    name: 'text-block-paragraph',
    render: () => (
      <Text block className="fx-prose">
        A paragraph that must wrap and shrink like a normal block `&lt;p&gt;`. Flex-shrink and
        block layout are the properties most at risk in the div→Stack swap, so this fixture pins
        them down explicitly with a constrained width.
      </Text>
    ),
  },
  {
    name: 'pressable-button',
    render: () => (
      <Pressable className="fx-btn" type="button">
        Click me
      </Pressable>
    ),
  },
  {
    name: 'pressable-anchor',
    render: () => (
      <Pressable as="a" href="#target" className="fx-link">
        Anchor pressable
      </Pressable>
    ),
  },
  {
    name: 'row-explicit',
    render: () => (
      <Box className="fx-row">
        <Box className="fx-chip">one</Box>
        <Box className="fx-chip">two</Box>
        <Box className="fx-chip">three</Box>
      </Box>
    ),
  },
  {
    name: 'col-explicit',
    render: () => (
      <Box className="fx-col">
        <Box className="fx-chip">alpha</Box>
        <Box className="fx-chip">beta</Box>
        <Box className="fx-chip">gamma</Box>
      </Box>
    ),
  },
  {
    name: 'list',
    render: () => (
      <List className="fx-list">
        <ListItem>first item</ListItem>
        <ListItem>second item</ListItem>
      </List>
    ),
  },
  {
    name: 'link',
    render: () => (
      <Link href="#somewhere" className="fx-link">
        a real link
      </Link>
    ),
  },
  {
    name: 'composite-card',
    render: () => (
      <Box as="article" className="fx-card">
        <Box className="fx-card-head">
          <Box className="fx-avatar" />
          <Box className="fx-card-meta">
            <Text as="strong" className="fx-title">
              Composite Card
            </Text>
            <Text as="small" className="fx-muted">
              nested rows, cols, text and a pressable
            </Text>
          </Box>
        </Box>
        <Text block className="fx-prose">
          Body copy that exercises nested flex containers with a constrained width so overflow
          and shrink behavior is observable.
        </Text>
        <Box className="fx-card-actions">
          <Pressable className="fx-btn" type="button">
            Confirm
          </Pressable>
          <Pressable className="fx-btn fx-btn--ghost" type="button">
            Cancel
          </Pressable>
        </Box>
      </Box>
    ),
  },
]
