/**
 * The native ENTRY the resolution gate bundles — the `@lmthing/ui` surface that is claimed to run
 * on React Native, imported the way a mobile app would import it (by barrel, never by an explicit
 * `index.tsx` path, so Metro's fork preference is the thing being exercised).
 *
 * This file is the frontier marker for the native port: everything imported here is PROVEN to
 * resolve and transform for `ios` and `android`. Porting a surface means adding it here and making
 * the gate green — which is also the moment its web-only imports have to move behind a `*.web.tsx`
 * seam. Do not add an import "to be checked later": a red gate blocks the whole harness.
 *
 * Not yet here: `chat/`, `studio/`, `computer/` (still className-driven, see
 * `docs/react-native-tamagui-migration.md` §1c), `elements/overlays/dropdown` (subscribes to
 * `document` with no fork — `.issues/dropdown-uses-document-with-no-native-fork.md`) and the rest of
 * the `elements/` layer.
 */
import * as Primitives from '../../src/elements/primitives'
import * as Platform from '../../src/platform'
import * as Dialog from '../../src/elements/overlays/dialog'
import * as Sheet from '../../src/elements/overlays/sheet'
import * as ContextMenu from '../../src/elements/overlays/context-menu'

// Referenced, not just imported: Metro does not tree-shake in dev, but an unused namespace import
// is exactly the kind of thing a future bundler flag would drop, and a gate that silently stops
// covering its subject is worse than no gate.
export const surface = { Primitives, Platform, Dialog, Sheet, ContextMenu }
