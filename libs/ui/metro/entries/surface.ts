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
 * Not yet here: the rest of `chat/`, `studio/`, `computer/`, and the parts of `elements/` the team
 * surface does not use. (The §1c className blocker this note used to cite is gone
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
// The chat surface itself — the thing the app exists to show. Everything above had to land first:
// the primitives, the markdown renderer, the transport seam, the session store and the deep-link
// seam are all reached THROUGH this import now.
import * as Chat from '../../src/chat'
// The team surface. It is the first thing here that renders a whole PRODUCT screen
// from shared source — `apps/mobile` mounts the same `TeamChannelsView` the web app
// does — so this import is what proves the claim. It drags in the `elements/` layer
// (avatar, list-item, button, input, textarea, separator, caption) and the inline
// SVG icon set, all of which had to resolve for native before it could land.
import * as Team from '../../src/team'
// The VIEW renderer — the reason the viewbuilder exists. A view spec is data, so the mobile
// app fetches one and renders it with this, the same module the web bundles: no WebView on
// any page, by construction. It drags in the whole element catalogue, the schema-derived
// form, the icon set and (through the `chat` section) `ReplChatView` — all of which had to
// resolve for native before a spec app could claim to run there.
import * as View from '../../src/view'

// Referenced, not just imported: Metro does not tree-shake in dev, but an unused namespace import
// is exactly the kind of thing a future bundler flag would drop, and a gate that silently stops
// covering its subject is worse than no gate.
export const surface = { Primitives, Platform, Dialog, Sheet, ContextMenu, Dropdown, Markdown, ChatAuth, Chat, Team, View }
