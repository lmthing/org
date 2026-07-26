/**
 * The two markdown scales, as prop bags — platform-free by construction (pure data).
 *
 * These replace `libs/css/src/components/markdown/index.css`, whose two classes styled HTML that
 * `marked` produced as a STRING. That worked on web and rendered nothing at all on native, because
 * there is no element to hold a class and `dangerouslySetInnerHTML` is dropped by the native
 * primitives on purpose.
 *
 * **`document` and `prose` are deliberately different**, exactly as `.lm-markdown` and `.lm-prose`
 * were. The document scale is for long-form content on a page (a space README, a store detail
 * page); the prose scale is the chat transcript, which is denser, uses the display font for
 * headings and tints links with `$agent` rather than `$primary`. Merging them would move the
 * transcript's layout, so they stay two presets.
 *
 * Sizes are NUMBERS (px), not the `rem`/`em` strings the stylesheets used. A `rem` is meaningless
 * to React Native and an `em` cannot be resolved without a cascade, so a string would style web and
 * silently do nothing on a device — the failure mode this whole migration exists to remove. The
 * conversions assume the 16px root the stylesheets did (0.875rem = 14) and the 14px base for the
 * `em`-relative prose values (1.4em = 19.6).
 */

export interface MarkdownPreset {
  container: Record<string, unknown>
  /**
   * Base typography, spread onto every TEXT-bearing node rather than set once on the container.
   *
   * On web a container `font-size`/`line-height`/`color` cascades into everything below it. React
   * Native has no cascade: text styles on a `View` are dropped, and a `Text` child renders at the
   * platform default. Setting these once at the top therefore styled web and silently did nothing
   * on a device — caught by `metro/suites/markdown.tsx`, which compares the two presets' resolved
   * line-height and found them identical because BOTH were being dropped.
   */
  text: Record<string, unknown>
  heading: (level: number) => Record<string, unknown>
  paragraph: Record<string, unknown>
  link: Record<string, unknown>
  list: Record<string, unknown>
  listItem: Record<string, unknown>
  codespan: Record<string, unknown>
  code: Record<string, unknown>
  blockquote: Record<string, unknown>
  hr: Record<string, unknown>
  table: Record<string, unknown>
  th: Record<string, unknown>
  td: Record<string, unknown>
  strong: Record<string, unknown>
  em: Record<string, unknown>
  image: Record<string, unknown>
  /** Raw `html` tokens are shown as escaped text — see `render.tsx` for why. */
  rawHtml: Record<string, unknown>
  /**
   * Which edge margins to drop, because the two stylesheets did NOT agree here:
   *
   *   `.lm-markdown > :first-child { margin-top: 0 }` and `> :last-child { margin-bottom: 0 }`
   *   `.lm-prose    p:last-child   { margin-bottom: 0 }`   <- paragraphs only, and no first rule
   *
   * Applying the document rule to prose pulled the transcript's first heading up by 19.6px. Caught
   * by the P0 diff, which is the only thing that could have.
   */
  trimFirstMargin: boolean
  trimLastMargin: 'any' | 'paragraph' | 'none'
}

/** `.lm-markdown` — the document scale. */
const DOCUMENT_HEADING_SIZE: Record<number, number> = { 1: 20, 2: 17.6, 3: 16, 4: 14.4, 5: 14, 6: 14 }

const DOCUMENT_TEXT = { fontSize: 14, lineHeight: 22.4, color: '$foreground' } as const

export const DOCUMENT: MarkdownPreset = {
  container: {},
  text: DOCUMENT_TEXT,
  heading: (level) => ({
    ...DOCUMENT_TEXT,
    color: '$foreground',
    fontWeight: '600',
    fontSize: DOCUMENT_HEADING_SIZE[level] ?? 14,
    lineHeight: (DOCUMENT_HEADING_SIZE[level] ?? 14) * 1.3,
    marginTop: 20,
    marginBottom: 8,
  }),
  paragraph: { ...DOCUMENT_TEXT, marginTop: 8, marginBottom: 8 },
  link: { ...DOCUMENT_TEXT, color: '$primary', textDecorationLine: 'underline' },
  list: { marginTop: 8, marginBottom: 8, paddingLeft: 22.4 },
  listItem: { ...DOCUMENT_TEXT, marginTop: 5.6, marginBottom: 5.6 },
  codespan: {
    backgroundColor: '$muted',
    color: '$foreground',
    fontFamily: '$mono',
    fontSize: 11.9,
    paddingHorizontal: 5.6,
    paddingVertical: 1.6,
    borderRadius: 4,
  },
  code: {
    borderColor: '$border',
    backgroundColor: '$muted',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    fontFamily: '$mono',
    fontSize: 11.9,
  },
  blockquote: {
    ...DOCUMENT_TEXT,
    borderLeftColor: '$border',
    borderLeftWidth: 3,
    color: '$muted-foreground',
    paddingLeft: 13.6,
    marginTop: 12,
    marginBottom: 12,
  },
  hr: { borderTopColor: '$border', borderTopWidth: 1, marginTop: 20, marginBottom: 20 },
  table: { marginTop: 12, marginBottom: 12, width: '100%' },
  th: {
    ...DOCUMENT_TEXT,
    borderColor: '$border',
    borderWidth: 1,
    paddingVertical: 6.4,
    paddingHorizontal: 9.6,
    textAlign: 'left',
    backgroundColor: '$muted',
    fontWeight: '600',
  },
  td: {
    ...DOCUMENT_TEXT,
    borderColor: '$border',
    borderWidth: 1,
    paddingVertical: 6.4,
    paddingHorizontal: 9.6,
    textAlign: 'left',
  },
  strong: { ...DOCUMENT_TEXT, fontWeight: '600' },
  em: { ...DOCUMENT_TEXT, fontStyle: 'italic' },
  image: { maxWidth: '100%', borderRadius: 8 },
  rawHtml: { fontFamily: '$mono', fontSize: 11.9, color: '$muted-foreground' },
  trimFirstMargin: true,
  trimLastMargin: 'any',
}

/** `.lm-prose` — the chat transcript scale. */
const PROSE_HEADING_SIZE: Record<number, number> = { 1: 19.6, 2: 16.8, 3: 14.7, 4: 14, 5: 14, 6: 14 }

const PROSE_TEXT = { fontSize: 14, lineHeight: 23.8 } as const

export const PROSE: MarkdownPreset = {
  container: {},
  text: PROSE_TEXT,
  heading: (level) => ({
    ...PROSE_TEXT,
    fontFamily: '$heading',
    fontWeight: '700',
    fontSize: PROSE_HEADING_SIZE[level] ?? 14,
    // Scales with the HEADING's size, not the base. `.lm-prose` set `line-height: 1.7` on the
    // container and let it cascade, so an `h1` at 1.4em resolved to 1.7 x 19.6 = 33.32px. Spreading
    // the base bag alone left it at the paragraph's 23.8 and squashed every heading — which the P0
    // diff showed as a 10px height drop.
    lineHeight: (PROSE_HEADING_SIZE[level] ?? 14) * 1.7,
    // `.lm-prose h1,h2,h3 { margin: 1em 0 0.4em }` — `em` on a heading is the HEADING's size, so
    // these scale too. Flattened to the base 14px they were visibly tighter above every heading.
    marginTop: PROSE_HEADING_SIZE[level] ?? 14,
    marginBottom: (PROSE_HEADING_SIZE[level] ?? 14) * 0.4,
  }),
  paragraph: { ...PROSE_TEXT, marginTop: 0, marginBottom: 10.5 },
  // `$agent` is the per-space runtime palette, not `$primary` — the transcript is tinted by
  // whichever space is speaking. See theme/theme.ts applyThemeTokens.
  link: { ...PROSE_TEXT, color: '$agent', textDecorationLine: 'underline' },
  list: { marginTop: 0, marginBottom: 10.5, paddingLeft: 21 },
  listItem: { ...PROSE_TEXT, marginBottom: 3.5 },
  codespan: {
    fontFamily: '$mono',
    fontSize: 11.9,
    backgroundColor: '$muted',
    color: '$foreground',
    paddingHorizontal: 4.9,
    paddingVertical: 1.4,
    borderRadius: 4,
  },
  code: {
    backgroundColor: '$muted',
    borderColor: '$border',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10.5,
    paddingHorizontal: 14,
    marginTop: 0,
    marginBottom: 10.5,
    fontFamily: '$mono',
    fontSize: 11.9,
  },
  blockquote: {
    ...DOCUMENT_TEXT,
    borderLeftColor: '$border',
    borderLeftWidth: 3,
    paddingLeft: 14,
    color: '$muted-foreground',
    marginTop: 0,
    marginBottom: 10.5,
  },
  hr: { borderTopColor: '$border', borderTopWidth: 1, marginTop: 14, marginBottom: 14 },
  table: { marginTop: 12, marginBottom: 12, width: '100%' },
  th: {
    borderColor: '$border',
    borderWidth: 1,
    paddingVertical: 6.4,
    paddingHorizontal: 9.6,
    textAlign: 'left',
    backgroundColor: '$muted',
    fontWeight: '600',
  },
  td: {
    borderColor: '$border',
    borderWidth: 1,
    paddingVertical: 6.4,
    paddingHorizontal: 9.6,
    textAlign: 'left',
  },
  strong: { ...PROSE_TEXT, fontWeight: '600' },
  em: { ...PROSE_TEXT, fontStyle: 'italic' },
  image: { maxWidth: '100%', borderRadius: 8 },
  rawHtml: { fontFamily: '$mono', fontSize: 11.9, color: '$muted-foreground' },
  trimFirstMargin: false,
  trimLastMargin: 'paragraph',
}

export const PRESETS = { document: DOCUMENT, prose: PROSE } as const
export type MarkdownPresetName = keyof typeof PRESETS
