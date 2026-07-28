import { WebView } from 'react-native-webview'
import * as Prim from '../elements/primitives/index'

/**
 * A project's app, running beside the conversation — the NATIVE half of the seam.
 *
 * A `WebView`, for the same reason web uses an iframe: a project app is a
 * separately built web bundle the pod serves at its own URL. There is no native
 * build of it and there should not be one — it is authored by an agent as pages
 * and API handlers, and shipping a second renderer for that would be a second
 * product.
 *
 * `react-native-webview` is a dependency of `apps/mobile`, not of this package —
 * it needs native modules linked into the app binary, so it can only be provided
 * by the shell. Metro resolves it from the app; the web bundle never sees this
 * file (Metro prefers `.native.tsx`, bundlers for web prefer the sibling).
 */
export function AppView({ url, title }: { url: string; title: string }) {
  return (
    <Prim.Box flex={1} minHeight={0} backgroundColor="$background">
      <WebView
        source={{ uri: url }}
        // The pod serves these; a member opening one is not leaving the app.
        originWhitelist={['*']}
        // Android defaults this off, and a project app is React — without it the
        // pane renders a blank white rectangle and nothing says why.
        javaScriptEnabled={true}
        domStorageEnabled={true}
        accessibilityLabel={title}
        style={{ flex: 1 }}
      />
    </Prim.Box>
  )
}
