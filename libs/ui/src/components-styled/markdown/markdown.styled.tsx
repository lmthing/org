/** markdown.styled.tsx — P2 conversion of the `.lm-markdown` rendered-markdown stylesheet
 *  (docs/tamagui-idiomatic-migration.md §4). Each descendant selector (`.lm-markdown h1`, ` code`,
 *  ` blockquote`, …) becomes its OWN styled() frame — the combinator can't be expressed
 *  structurally, so the frame is applied per leaf element by the renderer and the descendant
 *  relationship is noted in each comment. Frame names are globally-unique `Markdown*`. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.lm-markdown` container — text-foreground text-sm; line-height:1.6; break-word.
 *  Note: `> :first-child { margin-top:0 }` / `> :last-child { margin-bottom:0 }` are child
 *  combinators the renderer applies to the first/last rendered block. */
export const MarkdownFrame = styled(View, {
  name: 'Markdown',
  color: '$foreground',
  fontSize: '$sm',
  lineHeight: '1.6' as unknown as number,
  wordBreak: 'break-word',
})

// Shared heading base for `.lm-markdown h1..h4` — foreground, semibold, tight line, spaced margins.
const headingBase = {
  color: '$foreground',
  fontWeight: '$semibold',
  lineHeight: '1.3' as unknown as number,
  marginTop: '$5', // 1.25rem
  marginBottom: '$2', // 0.5rem
  marginHorizontal: 0,
} as const

/** `.lm-markdown h1` — font-size:1.25rem. */
export const MarkdownH1Frame = styled(Text, { name: 'MarkdownH1', ...headingBase, fontSize: '$xl' })
/** `.lm-markdown h2` — font-size:1.1rem. */
export const MarkdownH2Frame = styled(Text, { name: 'MarkdownH2', ...headingBase, fontSize: 17.6 }) // 1.1rem, no token
/** `.lm-markdown h3` — font-size:1rem. */
export const MarkdownH3Frame = styled(Text, { name: 'MarkdownH3', ...headingBase, fontSize: '$base' })
/** `.lm-markdown h4` — font-size:0.9rem. */
export const MarkdownH4Frame = styled(Text, { name: 'MarkdownH4', ...headingBase, fontSize: 14.4 }) // 0.9rem, no token

/** `.lm-markdown p` — margin:0.5rem 0. */
export const MarkdownPFrame = styled(Text, {
  name: 'MarkdownP',
  marginVertical: '$2',
})

/** `.lm-markdown a` — text-primary; underline; underline-offset:2px. */
export const MarkdownAFrame = styled(Text, {
  name: 'MarkdownA',
  color: '$primary',
  textDecorationLine: 'underline',
  textUnderlineOffset: 2,
})

/** `.lm-markdown ul` — margin:0.5rem 0; padding-left:1.4rem; list-style:disc. */
export const MarkdownUlFrame = styled(View, {
  name: 'MarkdownUl',
  marginVertical: '$2',
  paddingLeft: 22.4, // 1.4rem, no token
  listStyleType: 'disc',
})

/** `.lm-markdown ol` — margin:0.5rem 0; padding-left:1.4rem; list-style:decimal. */
export const MarkdownOlFrame = styled(View, {
  name: 'MarkdownOl',
  marginVertical: '$2',
  paddingLeft: 22.4, // 1.4rem, no token
  listStyleType: 'decimal',
})

/** `.lm-markdown li` — margin:0.35rem 0. Note: `li::marker` is text-muted-foreground (a ::marker
 *  pseudo the renderer styles on the list item; not expressible as a styled prop). */
export const MarkdownLiFrame = styled(Text, {
  name: 'MarkdownLi',
  marginVertical: 5.6, // 0.35rem, no token
})

/** `.lm-markdown code` — bg-muted text-foreground; mono; font-size:0.85em; padded; rounded. */
export const MarkdownCodeFrame = styled(Text, {
  name: 'MarkdownCode',
  backgroundColor: '$muted',
  color: '$foreground',
  fontFamily: 'monospace',
  fontSize: '0.85em' as unknown as number, // relative em, no token
  paddingVertical: 1.6, // 0.1rem
  paddingHorizontal: 5.6, // 0.35rem
  borderRadius: '$radius-sm', // 0.25rem
})

/** `.lm-markdown pre` — bg-muted border-border; 1px border; rounded-lg; padded; overflow-x auto. */
export const MarkdownPreFrame = styled(View, {
  name: 'MarkdownPre',
  backgroundColor: '$muted',
  borderColor: '$border',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: '$radius-lg', // 0.5rem
  paddingVertical: '$3', // 0.75rem
  paddingHorizontal: '$4', // 1rem
  overflowX: 'auto',
  marginVertical: '$3',
})

/** `.lm-markdown pre code` — background:transparent; padding:0. Note: descendant of `pre`; the
 *  renderer applies this frame to a `code` nested inside a `pre`. */
export const MarkdownPreCodeFrame = styled(Text, {
  name: 'MarkdownPreCode',
  backgroundColor: 'transparent',
  padding: 0,
})

/** `.lm-markdown blockquote` — border-border text-muted-foreground; 3px left rule; padded. */
export const MarkdownBlockquoteFrame = styled(View, {
  name: 'MarkdownBlockquote',
  borderColor: '$border',
  color: '$muted-foreground',
  borderLeftWidth: 3,
  borderLeftStyle: 'solid',
  paddingLeft: 13.6, // 0.85rem, no token
  marginVertical: '$3',
})

/** `.lm-markdown hr` — border-border; border:0; 1px top rule; margin:1.25rem 0. */
export const MarkdownHrFrame = styled(View, {
  name: 'MarkdownHr',
  borderColor: '$border',
  borderWidth: 0,
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  marginVertical: '$5',
})

/** `.lm-markdown table` — collapsed borders; full width; block; overflow-x auto. */
export const MarkdownTableFrame = styled(View, {
  name: 'MarkdownTable',
  borderCollapse: 'collapse',
  marginVertical: '$3',
  width: '100%',
  display: 'block',
  overflowX: 'auto',
})

// Shared cell base for `.lm-markdown th, .lm-markdown td` — 1px border, padded, left-aligned.
const cellBase = {
  borderColor: '$border',
  borderWidth: 1,
  borderStyle: 'solid',
  paddingVertical: 6.4, // 0.4rem
  paddingHorizontal: 9.6, // 0.6rem
  textAlign: 'left',
} as const

/** `.lm-markdown th` — cell base + bg-muted; font-weight:600. */
export const MarkdownThFrame = styled(View, {
  name: 'MarkdownTh',
  ...cellBase,
  backgroundColor: '$muted',
  fontWeight: '$semibold',
})
/** `.lm-markdown td` — cell base. */
export const MarkdownTdFrame = styled(View, { name: 'MarkdownTd', ...cellBase })

/** `.lm-markdown strong` — font-weight:600. */
export const MarkdownStrongFrame = styled(Text, {
  name: 'MarkdownStrong',
  fontWeight: '$semibold',
})

/** `.lm-markdown img` — max-width:100%; height:auto; rounded-lg. */
export const MarkdownImgFrame = styled(View, {
  name: 'MarkdownImg',
  maxWidth: '100%',
  height: 'auto',
  borderRadius: '$radius-lg', // 0.5rem
})

export interface StyledMarkdownProps extends React.ComponentProps<'div'> {}

const Frame = MarkdownFrame as unknown as React.ComponentType<any>

/** Idiomatic markdown container — renders the `.lm-markdown` base frame. */
export function StyledMarkdown({ ...props }: StyledMarkdownProps) {
  return <Frame {...props} />
}
