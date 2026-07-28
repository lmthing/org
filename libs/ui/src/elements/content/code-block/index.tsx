import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * A fenced code block that does not eat the screen.
 *
 * THING answers with source: an API handler, a table schema, a page component. On a wide window
 * that is a block you scroll past in a second. On a phone it is thirty screenfuls of wrapped
 * identifiers between one sentence and the next — in a team channel, the thread that produced an
 * app became unreadable, and the message AFTER the code was unreachable without a long thumb drag.
 *
 * So anything past `COLLAPSE_AFTER_LINES` opens as a peek with a control that says how much is
 * hidden. Short blocks — the two-line snippet somebody pasted to make a point — are untouched,
 * because collapsing those would add a click to a thing that was already readable.
 *
 * The threshold is on LINES rather than characters: what costs a reader is vertical distance, and
 * one 400-character line wraps to about six on a phone whereas six short lines are six.
 */

/** Longer than this and the block opens collapsed. Six lines is about a third of a phone screen. */
const COLLAPSE_AFTER_LINES = 12

/** How much of a collapsed block stays visible — enough to recognise it, not enough to read it. */
const PEEK_LINES = 6

export interface CodeBlockProps {
  code: string
  /** The fence's language, when it had one. Shown in the header. */
  language?: string | undefined
  /** Style props for the `<pre>` itself — the markdown preset's `code` bag. */
  preProps?: Record<string, unknown>
  /**
   * What the peek fades INTO. Defaults to the page background; a caller whose block sits on a
   * different surface passes that surface's colour, or the fade is a visible band of the wrong one.
   */
  fadeColor?: string
}

export function CodeBlock({ code, language, preProps, fadeColor = 'var(--background)' }: CodeBlockProps) {
  const lines = React.useMemo(() => code.split('\n'), [code])
  const collapsible = lines.length > COLLAPSE_AFTER_LINES
  const [open, setOpen] = React.useState(false)

  const shown = collapsible && !open ? lines.slice(0, PEEK_LINES).join('\n') : code
  const hidden = lines.length - PEEK_LINES

  if (!collapsible) {
    return (
      <Prim.Text as="pre" {...preProps}>
        {code}
      </Prim.Text>
    )
  }

  return (
    // The disclosure belongs to the block ABOVE it, and the two are spaced as one thing — with a
    // preset's own `marginVertical` still on the `<pre>`, the button sat exactly as far from its
    // own block as from the next one and read as a header for the wrong code.
    <Prim.Col gap="$1" marginVertical="$1">
      <Prim.Box position="relative">
        <Prim.Text as="pre" {...preProps} marginVertical={0}>
          {shown}
        </Prim.Text>
        {/* A collapsed block ends mid-statement, which reads as a rendering fault unless something
            says otherwise. The fade says "there is more" before the button has to. */}
        {open ? null : (
          <Prim.Box
            position="absolute"
            left={0}
            right={0}
            bottom={0}
            height={40}
            pointerEvents="none"
            backgroundImage={`linear-gradient(to bottom, transparent, ${fadeColor})`}
          />
        )}
      </Prim.Box>
      <Prim.Pressable
        onClick={() => setOpen((v) => !v)}
        alignSelf="flex-start"
        display="flex"
        flexDirection="row"
        alignItems="center"
        gap="$1.5"
        paddingVertical="$1"
        paddingHorizontal="$2"
        borderRadius="$radius-md"
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$background"
        pressStyle={{ opacity: 0.6 }}
        hoverStyle={{ backgroundColor: '$muted' }}
        aria-expanded={open}
      >
        <Prim.Text fontSize="$xs" fontWeight="$medium" color="$muted-foreground">
          {open
            ? 'Hide code'
            : `Show ${hidden} more ${hidden === 1 ? 'line' : 'lines'}${language ? ` of ${language}` : ''}`}
        </Prim.Text>
      </Prim.Pressable>
    </Prim.Col>
  )
}
