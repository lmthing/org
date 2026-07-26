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
 * Not yet here: the rest of `chat/`, `studio/`, `computer/` and the `elements/` layer above the
 * primitives, the overlays and markdown. (The §1c className blocker this note used to cite is gone
 * — Tailwind was deleted; see docs/mobile-native-chat.md.)
 */
import * as Primitives from '../../src/elements/primitives'
import * as Platform from '../../src/platform'
import * as Dialog from '../../src/elements/overlays/dialog'
import * as Sheet from '../../src/elements/overlays/sheet'
import * as ContextMenu from '../../src/elements/overlays/context-menu'
import * as Dropdown from '../../src/elements/overlays/dropdown'
// Markdown is the first non-primitive surface to enter the graph, and the reason chat can follow:
// it renders `marked` tokens as primitives, so the transcript no longer depends on a DOM to inject
// HTML into. Everything it touches (Text/Box/List/Link/Image/Table) is already proven above.
import * as Markdown from '../../src/elements/content/markdown'
// The first file of `chat/` on the native graph, and the smallest possible one: the token accessors
// every other chat module calls before it can talk to a pod. It drags in `@lmthing/auth`, which is
// the point — that package reads the session, and reading it on native means the keystore seam
// (`libs/auth/src/platform/session-store.native.ts`) has to be the half Metro picks.
import * as ChatAuth from '../../src/chat/app/auth'

// Referenced, not just imported: Metro does not tree-shake in dev, but an unused namespace import
// is exactly the kind of thing a future bundler flag would drop, and a gate that silently stops
// covering its subject is worse than no gate.
export const surface = { Primitives, Platform, Dialog, Sheet, ContextMenu, Dropdown, Markdown, ChatAuth }
