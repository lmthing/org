import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Select } from '@lmthing/ui/elements/forms/select'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Card, CardHeader, CardBody, CardFooter } from '@lmthing/ui/elements/content/card'
import { Panel, PanelHeader, PanelBody } from '@lmthing/ui/elements/content/panel'
import { Avatar } from '@lmthing/ui/elements/content/avatar'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Separator } from '@lmthing/ui/elements/content/separator'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Code } from '@lmthing/ui/elements/typography/code'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Page, PageHeader, PageBody } from '@lmthing/ui/elements/layouts/page'
import { TopBar } from '@lmthing/ui/elements/nav/top-bar'
import { TabBar } from '@lmthing/ui/elements/nav/tab-bar'
import { Breadcrumb } from '@lmthing/ui/elements/nav/breadcrumb'
import { AppLinks } from '@lmthing/ui/elements/nav/app-links'

/**
 * The P0 real-surface fixtures.
 *
 * These render the SHIPPED components — the ones the app imports — under the real `theme.css`
 * (Tailwind preflight + the token custom properties), which is the environment production runs in.
 * That is the difference from `tests/visual/`: those fixtures render local PASSTHROUGH copies of
 * the pre-Tamagui primitives so their pre-swap baselines stay byte-valid, which means they no
 * longer say anything about the components that ship.
 *
 * The baseline this captures is the review artefact for the two remaining changes that alter
 * output app-wide — the animation driver and the Tailwind deletion. Neither can be reviewed by
 * reading a diff; both can be reviewed as a computed-style delta over these fixtures.
 *
 * See docs/tamagui-idiomatic-migration.md §2 (P0).
 */

export interface Fixture {
  name: string
  render: () => React.ReactNode
}

export const FIXTURES: Fixture[] = [
  // ── typography ────────────────────────────────────────────────────────────────────────────
  {
    name: 'typography',
    render: () => (
      <>
        <Heading level={1}>Heading one</Heading>
        <Heading level={3}>Heading three</Heading>
        <Label>Field label</Label>
        <Caption>Caption text</Caption>
        <Caption muted>Muted caption</Caption>
        <Code>inline code</Code>
        <Code block>{'const x = 1\nconst y = 2'}</Code>
        <CozyThingText text="lmthing" />
      </>
    ),
  },

  // ── forms ─────────────────────────────────────────────────────────────────────────────────
  {
    name: 'forms',
    render: () => (
      <>
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button size="sm">Small</Button>
        <Button size="icon">×</Button>
        <Button disabled>Disabled</Button>
        <Input placeholder="Text input" defaultValue="value" />
        <Input error defaultValue="bad" />
        <Input size="sm" defaultValue="compact" />
        <Textarea defaultValue={'line one\nline two'} />
        <Select defaultValue="a">
          <Prim.Option value="a">A</Prim.Option>
          <Prim.Option value="b">B</Prim.Option>
        </Select>
      </>
    ),
  },

  // ── content surfaces ──────────────────────────────────────────────────────────────────────
  {
    name: 'content',
    render: () => (
      <>
        <Card>
          <CardHeader><Heading level={4}>Card</Heading></CardHeader>
          <CardBody>Body copy for the card surface.</CardBody>
          <CardFooter><Button size="sm">Action</Button></CardFooter>
        </Card>
        <Card interactive>Interactive card</Card>
        <Panel>
          <PanelHeader>Panel header</PanelHeader>
          <PanelBody>Panel body</PanelBody>
        </Panel>
        <Badge>Default</Badge>
        <Badge variant="primary">Primary</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="muted">Muted</Badge>
        <Avatar name="Ada Lovelace" />
        <ListItem>List item</ListItem>
        <ListItem selected>Selected item</ListItem>
        <Separator />
      </>
    ),
  },

  // ── layout ────────────────────────────────────────────────────────────────────────────────
  {
    name: 'layout',
    render: () => (
      <>
        <Stack gap="sm"><Prim.Box>a</Prim.Box><Prim.Box>b</Prim.Box></Stack>
        <Stack row gap="lg"><Prim.Box>a</Prim.Box><Prim.Box>b</Prim.Box></Stack>
        <Page>
          <PageHeader><Heading level={2}>Page</Heading></PageHeader>
          <PageBody>Page body</PageBody>
        </Page>
        <Prim.Row gap="$2"><Prim.Text>row</Prim.Text></Prim.Row>
        <Prim.Col gap="$2"><Prim.Text>col</Prim.Text></Prim.Col>
      </>
    ),
  },

  // ── nav ───────────────────────────────────────────────────────────────────────────────────
  {
    name: 'nav',
    render: () => (
      <>
        <TopBar title="Top bar" actions={<Button size="sm">Act</Button>} />
        <TabBar tabs={[{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }]} activeTab="a" />
        <Breadcrumb segments={[{ label: 'root' }, { label: 'leaf' }]} />
        <AppLinks current="studio" />
        <AppLinks current="studio" bordered />
      </>
    ),
  },

  // ── the leaves that only recently gained style props ──────────────────────────────────────
  {
    name: 'leaves',
    render: () => (
      <>
        <Prim.Pre fontFamily="$mono" fontSize="$sm" backgroundColor="$muted" padding="$2">
          {'pre block'}
        </Prim.Pre>
        <Prim.Table width="100%">
          <Prim.Thead>
            <Prim.Tr><Prim.Th textAlign="left" padding="$2">Head</Prim.Th></Prim.Tr>
          </Prim.Thead>
          <Prim.Tbody>
            <Prim.Tr><Prim.Td color="$muted-foreground" padding="$2">Cell</Prim.Td></Prim.Tr>
          </Prim.Tbody>
        </Prim.Table>
        <Prim.List><Prim.ListItem>li</Prim.ListItem></Prim.List>
        <Prim.Link href="/x">link</Prim.Link>
      </>
    ),
  },

  // ── the state variants that live as PROPS now, not `:hover` rules ─────────────────────────
  {
    name: 'state-props',
    render: () => (
      <>
        <Prim.Box
          padding="$2"
          backgroundColor="$card"
          hoverStyle={{ backgroundColor: '$muted' }}
          pressStyle={{ opacity: 0.7 }}
          focusVisibleStyle={{ outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring' }}
        >
          hover / press / focus
        </Prim.Box>
        {/* The hover GROUP that replaced every `:hover .child` combinator. */}
        <Prim.Box {...({ group: 'row' } as Record<string, unknown>)} padding="$2">
          <Prim.Text>row</Prim.Text>
          <Prim.Text opacity={0} $group-row-hover={{ opacity: 1 }}>revealed</Prim.Text>
        </Prim.Box>
      </>
    ),
  },

  // ── the animation family ──────────────────────────────────────────────────────────────────
  // The 67 remaining `transition-*` / `animate-*` / `lm-*` classNames are the LAST Tailwind
  // dependency and the reason P0 exists: swapping them for an animation driver changes visible
  // motion app-wide. They are exercised here explicitly so the swap is a reviewable delta.
  {
    name: 'animation',
    render: () => (
      <>
        {/* The Tailwind utilities, and the `transition` prop that replaces each one, measured
            side by side so the swap is a readable delta rather than a claim. */}
        <Prim.Box className="transition-colors" padding="$2">tw:colors</Prim.Box>
        <Prim.Box transition="quick" animateOnly={['color', 'background-color', 'border-color']} padding="$2">prop:colors</Prim.Box>
        <Prim.Box className="transition-all duration-200" padding="$2">tw:all/200</Prim.Box>
        <Prim.Box transition="medium" padding="$2">prop:all/200</Prim.Box>
        <Prim.Box className="transition-opacity duration-150" padding="$2">tw:opacity</Prim.Box>
        <Prim.Box transition="quick" animateOnly={['opacity']} padding="$2">prop:opacity</Prim.Box>
        <Prim.Box className="transition-transform" padding="$2">tw:transform</Prim.Box>
        <Prim.Box transition="quick" animateOnly={['transform']} padding="$2">prop:transform</Prim.Box>
        <Prim.Box className="transition-shadow" padding="$2">tw:shadow</Prim.Box>
        <Prim.Box transition="quick" animateOnly={['box-shadow']} padding="$2">prop:shadow</Prim.Box>
        {/* Keyframes are NOT the driver's job — these stay hand-written CSS. */}
        <Prim.Box className="lm-fade-in" padding="$2">lm-fade-in</Prim.Box>
        <Prim.Text className="lm-spin">⟳</Prim.Text>
        <Prim.Box className="lm-pulse" padding="$2">lm-pulse</Prim.Box>
        {/* The rest of the keyframe family, measured because phase 2 MOVES it out of the chat
            route's Tailwind entry into `@lmthing/css/animations.css`. Without these rows that move
            is unreviewable: `animation-name`/`-duration`/`-iteration-count` are in the audited set,
            so a wrong timing or a dropped `@keyframes` shows up as a baseline delta instead of as
            motion nobody notices until it ships. */}
        <Prim.Box className="lm-slide-in-right" padding="$2">lm-slide-in-right</Prim.Box>
        {/* `.streaming-cursor` animates its ::after, which the walk cannot reach (it reads
            `getComputedStyle(el)`, no pseudo argument). The row pins the HOST element only — the
            cursor's own motion is covered by `libs/css/src/animations.test.mjs`. */}
        <Prim.Box className="streaming-cursor" padding="$2">streaming-cursor</Prim.Box>
        {/* Tailwind's last two animation utilities. Phase 2 replaces these with hand-written
            equivalents in `animations.css` so the Tailwind deletion cannot take them; they are
            captured HERE, while Tailwind still generates them, so "equivalent" is a measured
            zero-delta rather than a claim. */}
        <Prim.Text className="animate-spin">⟳</Prim.Text>
        <Prim.Box className="animate-pulse" padding="$2">animate-pulse</Prim.Box>
      </>
    ),
  },
]

export const FIXTURE_NAMES = FIXTURES.map((f) => f.name)
