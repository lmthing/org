/**
 * Markdown — renders a trusted markdown string (e.g. an integration space's
 * bundled `README.md`) into token-styled HTML. Uses the `marked` parser (already
 * a dep of this package) and the `.lm-markdown` design-token stylesheet.
 *
 * Content is TRUSTED (shipped in-repo, not user-authored), so the parsed HTML is
 * injected directly. Do NOT feed untrusted input here without sanitizing.
 */
import * as Prim from '../../primitives/index';
import '@lmthing/css/components/markdown/index.css'
import { useMemo } from 'react'
import { marked } from 'marked'

export interface MarkdownProps {
  /** Raw markdown source. */
  source: string
  className?: string
}

/** Renders `source` as HTML inside a `.lm-markdown` container. */
export function Markdown({ source, className }: MarkdownProps) {
  const html = useMemo(() => {
    try {
      // `gfm` for tables/task-lists; `breaks` so single newlines render as <br>.
      return marked.parse(source ?? '', { gfm: true, breaks: true, async: false }) as string
    } catch {
      return ''
    }
  }, [source])

  return (
    <Prim.Box
      className={className ? `lm-markdown ${className}` : 'lm-markdown'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export { Markdown as default }
