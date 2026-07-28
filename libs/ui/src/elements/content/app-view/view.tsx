import * as Prim from '../../primitives/index'

/**
 * A project's app, embedded — the WEB half of the seam.
 *
 * A shared element rather than part of `team/`, because "show a page this pod serves" is not a
 * team idea: a personal project has an app too, and on a phone this is the ONLY way to look at
 * one. It lived under `team/` purely because that is where it was first needed.
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
 * Native takes `./view.native.tsx`, which renders a `WebView`; `index.ts` explains why the fork is
 * one level in rather than at the entry.
 */
export function AppView({ url, title }: { url: string; title: string }) {
  return (
    <Prim.Box flex={1} minHeight={0} backgroundColor="$background">
      <iframe src={url} title={title} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
    </Prim.Box>
  )
}
