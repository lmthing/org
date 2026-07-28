import * as React from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { isWeb } from '@tamagui/core'
import * as Prim from '../../primitives/index'
import { PRESETS, type MarkdownPreset, type MarkdownPresetName } from './presets'
import { CodeBlock } from '../code-block/index'

/**
 * Markdown rendered as REACT ELEMENTS, from `marked`'s token stream — one implementation for web
 * and native.
 *
 * Every markdown surface in this repo used to be `marked.parse(source)` handed to
 * `dangerouslySetInnerHTML`. On web that works. On native it renders **nothing**: the native
 * primitives drop `dangerouslySetInnerHTML` deliberately (`primitives/_native.tsx`
 * WEB_ONLY_ATTRIBUTES), because there is no DOM to inject into. Since the transcript is the most
 * user-visible thing in the product, forking it was the one option worth ruling out — so the parse
 * stops at `marked.lexer` and the tokens become primitives that both targets already render.
 *
 * It also removes the trusted-HTML caveat the old `Markdown` element carried: nothing is injected,
 * so a hostile string is text rather than markup.
 *
 * **Raw `html` tokens render as escaped TEXT.** Injected HTML rendered live on web before, so this
 * is a real behaviour change, taken deliberately: dropping the token would make model output
 * disappear with no trace (the silent-failure class this codebase keeps getting bitten by), and
 * injecting it is exactly what cannot work on native. Showing the source is the option where
 * nothing is lost and the transcript makes it obvious what the model emitted.
 */

export interface MarkdownRenderProps {
  /** Raw markdown source. */
  source: string
  /** Which scale to use — `document` for long-form pages, `prose` for the chat transcript. */
  preset?: MarkdownPresetName
}

/** Inline tokens (`strong`, `em`, `codespan`, `link`, `text`, `br`, raw `html`). */
function renderInline(tokens: Token[] | undefined, p: MarkdownPreset, keyPrefix = ''): React.ReactNode {
  if (!tokens?.length) return null
  return tokens.map((token, i) => {
    const key = `${keyPrefix}i${i}`
    switch (token.type) {
      case 'strong':
        return (
          <Prim.Text key={key} as="strong" {...p.strong}>
            {renderInline((token as Tokens.Strong).tokens, p, `${key}-`)}
          </Prim.Text>
        )
      case 'em':
        return (
          <Prim.Text key={key} as="em" {...p.em}>
            {renderInline((token as Tokens.Em).tokens, p, `${key}-`)}
          </Prim.Text>
        )
      case 'codespan':
        return (
          <Prim.Text key={key} as="code" {...p.codespan}>
            {(token as Tokens.Codespan).text}
          </Prim.Text>
        )
      case 'link':
        return (
          <Prim.Link key={key} href={(token as Tokens.Link).href} {...p.link}>
            {renderInline((token as Tokens.Link).tokens, p, `${key}-`) ?? (token as Tokens.Link).text}
          </Prim.Link>
        )
      case 'image':
        return <Prim.Image key={key} src={(token as Tokens.Image).href} alt={(token as Tokens.Image).text} {...p.image} />
      case 'br':
        return <Prim.Br key={key} />
      case 'del':
        return (
          <Prim.Text key={key} textDecorationLine="line-through">
            {renderInline((token as Tokens.Del).tokens, p, `${key}-`)}
          </Prim.Text>
        )
      case 'html':
        // Shown, not run. See the header note.
        return (
          <Prim.Text key={key} {...p.rawHtml}>
            {(token as Tokens.HTML).raw}
          </Prim.Text>
        )
      default:
        return <React.Fragment key={key}>{(token as Tokens.Text).raw ?? ''}</React.Fragment>
    }
  })
}

/** One block-level token. */
function renderBlock(token: Token, p: MarkdownPreset, key: string): React.ReactNode {
  switch (token.type) {
    case 'heading': {
      const h = token as Tokens.Heading
      const level = Math.min(Math.max(h.depth, 1), 6)
      return (
        <Prim.Text key={key} as={`h${level}` as 'h1'} {...p.heading(level)}>
          {renderInline(h.tokens, p, `${key}-`)}
        </Prim.Text>
      )
    }
    case 'paragraph':
      return (
        <Prim.Text key={key} as="p" {...p.paragraph}>
          {renderInline((token as Tokens.Paragraph).tokens, p, `${key}-`)}
        </Prim.Text>
      )
    case 'text': {
      const t = token as Tokens.Text
      return (
        <Prim.Text key={key} as="p" {...p.paragraph}>
          {t.tokens ? renderInline(t.tokens, p, `${key}-`) : t.text}
        </Prim.Text>
      )
    }
    case 'code': {
      const code = token as Tokens.Code
      // `Prim.Text as="pre"` rather than `Prim.Pre`: Pre is a host-passthrough primitive that
      // ignores style props (it forwards to a raw tag), so a preset spread onto it would silently
      // style nothing. `as="pre"` is a real Tamagui per-tag component. `CodeBlock` keeps that and
      // adds the one thing a phone needs: a long block opens collapsed instead of burying the rest
      // of the message under it.
      return (
        <CodeBlock
          key={key}
          code={code.text}
          {...(code.lang ? { language: code.lang } : {})}
          preProps={p.code}
        />
      )
    }
    case 'blockquote':
      return (
        <Prim.Box key={key} as="blockquote" {...p.blockquote}>
          {(token as Tokens.Blockquote).tokens.map((t, i) => renderBlock(t, p, `${key}-b${i}`))}
        </Prim.Box>
      )
    case 'list': {
      const list = token as Tokens.List
      return (
        <Prim.List key={key} ordered={list.ordered} {...p.list}>
          {list.items.map((item, i) => (
            <Prim.ListItem key={`${key}-li${i}`} {...p.listItem}>
              {item.tokens.map((t, j) =>
                // A tight list item holds inline tokens under a `text` token; rendering it as a
                // paragraph would add the paragraph's margins inside every bullet.
                //
                // The wrapper is a `Text`, not a Fragment, and that is load-bearing: `ListItem` is
                // a VIEW on native, and React Native refuses to render a bare string inside a View
                // ("Text strings must be rendered within a <Text> component"). With a Fragment the
                // three bullets of a list simply did not appear on a device — while the render
                // suite passed, because react-test-renderer does not enforce that rule. Only
                // running it on the emulator showed it.
                //
                // The MARKER goes INSIDE that same Text, not beside it. `list-style: disc|decimal`
                // is a CSS concept with no React Native equivalent, so items rendered with no
                // bullet at all on a device; but a marker as a SIBLING would stack above the text,
                // since a native ListItem is a column View. As a text prefix it simply reads as
                // part of the line. `isWeb` leaves the browser on its own native marker — drawing
                // a second one there would move the P0 baseline for every list in the web app.
                t.type === 'text' ? (
                  <Prim.Text key={`${key}-li${i}-${j}`} {...p.text}>
                    {!isWeb && `${list.ordered ? `${(list.start || 1) + i}.` : '\u2022'} `}
                    {renderInline((t as Tokens.Text).tokens ?? [t], p, `${key}-li${i}-${j}-`)}
                  </Prim.Text>
                ) : (
                  renderBlock(t, p, `${key}-li${i}-${j}`)
                ),
              )}
            </Prim.ListItem>
          ))}
        </Prim.List>
      )
    }
    case 'hr':
      return <Prim.Box key={key} {...p.hr} />
    case 'table': {
      const table = token as Tokens.Table
      return (
        <Prim.Table key={key} {...p.table}>
          <Prim.Thead>
            <Prim.Tr>
              {table.header.map((cell, i) => (
                <Prim.Th key={`${key}-h${i}`} {...p.th}>
                  {renderInline(cell.tokens, p, `${key}-h${i}-`)}
                </Prim.Th>
              ))}
            </Prim.Tr>
          </Prim.Thead>
          <Prim.Tbody>
            {table.rows.map((row, r) => (
              <Prim.Tr key={`${key}-r${r}`}>
                {row.map((cell, c) => (
                  <Prim.Td key={`${key}-r${r}c${c}`} {...p.td}>
                    {renderInline(cell.tokens, p, `${key}-r${r}c${c}-`)}
                  </Prim.Td>
                ))}
              </Prim.Tr>
            ))}
          </Prim.Tbody>
        </Prim.Table>
      )
    }
    case 'html':
      return (
        <Prim.Text key={key} as="p" {...p.rawHtml}>
          {(token as Tokens.HTML).raw.trim()}
        </Prim.Text>
      )
    case 'space':
      return null
    default:
      return (
        <Prim.Text key={key} as="p" {...p.paragraph}>
          {(token as { raw?: string }).raw ?? ''}
        </Prim.Text>
      )
  }
}

/** Parse `source` to tokens and render them as primitives. */
export function MarkdownRender({ source, preset = 'document' }: MarkdownRenderProps): React.ReactElement {
  const p = PRESETS[preset]
  const tokens = React.useMemo(() => {
    try {
      // `gfm` for tables and task lists; `breaks` so a single newline is a line break, matching
      // what `marked.parse` was called with on the chat path.
      return marked.lexer(source ?? '', { gfm: true, breaks: true })
    } catch {
      return []
    }
  }, [source])

  // `.lm-markdown > :first-child { margin-top: 0 }` / `> :last-child { margin-bottom: 0 }` — the
  // rule that stops a block's own margin pushing the whole container away from what it sits in.
  // There is no `:first-child` selector to inherit here, and no margin COLLAPSE on React Native
  // either, so it is applied as props. The P0 baseline is what caught its absence: the leading
  // `<h1>` gained a 20px top margin it never had.
  const blocks = tokens.map((t, i) => renderBlock(t, p, `b${i}`))
  const trimmed = blocks.map((node, i) => {
    if (!React.isValidElement(node)) return node
    const edge: Record<string, number> = {}
    if (i === 0 && p.trimFirstMargin) edge.marginTop = 0
    const isLast = i === blocks.length - 1
    const lastRule = p.trimLastMargin
    if (isLast && (lastRule === 'any' || (lastRule === 'paragraph' && tokens[i]?.type === 'paragraph'))) {
      edge.marginBottom = 0
    }
    return Object.keys(edge).length ? React.cloneElement(node as React.ReactElement<any>, edge) : node
  })

  return <Prim.Box {...p.container}>{trimmed}</Prim.Box>
}
