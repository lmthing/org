/**
 * Icons — the WEB half of the icon seam.
 *
 * This is a `primitive` fork in the sense `docs/mobile-native-chat.md` allows: the two targets have
 * genuinely different host elements for the same drawing. `lucide-react` renders raw DOM
 * `<svg>`/`<path>`, which React Native has no host component for at all — mounting one is a hard
 * `View config getter callback for component 'path' must be a function`. The native sibling draws
 * the same glyphs through `react-native-svg`.
 *
 * Going the other way is just as real: the native set reaches `react-native-svg`, whose
 * `react-native` entry is Flow-annotated source, so putting it on the WEB path drags React Native
 * into a bundle that has no business parsing it.
 *
 * Re-exporting by name (rather than `export *`) is deliberate — it is the list of icons the shared
 * surfaces actually use, so the two forks cannot drift into exporting different sets, and adding an
 * icon is a two-line change that fails loudly on the target you forgot.
 *
 * Callers pass `size={n}` and `style`, which BOTH sets accept. Do not reach past this module for an
 * icon in shared code: `libs/ui/metro/graph-gate.mjs` fails the build if `lucide-react` appears in
 * the native graph, and that gate is the only thing standing between a new icon import and a
 * crash on a device.
 */
export {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Cpu,
  GitBranch,
  PanelLeft,
  Plus,
  Settings,
  Share2,
  Star,
  Terminal,
  User,
  Webhook,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
