/**
 * Markdown — renders a markdown string as React elements, on web and on React Native.
 *
 * Was `marked.parse(source)` handed to `dangerouslySetInnerHTML` under a `.lm-markdown`
 * stylesheet. That rendered nothing at all on native (the native primitives drop
 * `dangerouslySetInnerHTML` by design, because there is no DOM to inject into) and it required
 * every caller to guarantee the source was trusted. Both problems are gone: the tokens become
 * primitives, so nothing is injected and a hostile string renders as text rather than as markup.
 * See `render.tsx` for the reasoning, including why raw `html` tokens are shown as escaped text.
 *
 * `preset` picks the scale — `document` (the old `.lm-markdown`, long-form page content) or
 * `prose` (the old `.lm-prose`, the denser chat transcript). They stay separate on purpose; see
 * `presets.ts`.
 */
export { MarkdownRender as Markdown, MarkdownRender as default } from './render'
export type { MarkdownRenderProps as MarkdownProps } from './render'
export { PRESETS, DOCUMENT, PROSE } from './presets'
export type { MarkdownPreset, MarkdownPresetName } from './presets'
