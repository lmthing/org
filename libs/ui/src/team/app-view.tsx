import * as Prim from '../elements/primitives/index'

/**
 * A project's app, running beside the conversation — the WEB half of the seam.
 *
 * An embedded document rather than a mounted component on either target: a
 * project app is a separately built bundle the pod serves at its own URL with its
 * own router, and rendering it inline would mean a second copy of the app runtime
 * inside this one.
 *
 * Web uses a real `<iframe>`. `Prim.Box`'s `as` is a closed set of semantic block
 * tags and nothing in the design system wraps an embedded document, so this is
 * the one place a raw host element is correct. The inline style carries layout
 * only — no colour crosses this boundary, which is what keeps `lint:tokens` a
 * meaningful gate.
 *
 * Native takes `./app-view.native.tsx`, which renders a `WebView`.
 */
export function AppView({ url, title }: { url: string; title: string }) {
  return (
    <Prim.Box flex={1} minHeight={0} backgroundColor="$background">
      <iframe src={url} title={title} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
    </Prim.Box>
  )
}
