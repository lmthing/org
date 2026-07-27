/**
 * Icons — the NATIVE half of the icon seam. See `index.tsx` for why this fork exists.
 *
 * `@tamagui/lucide-icons-2` draws the same glyphs through `react-native-svg`, i.e. real RN host
 * components, and takes its dimensions from a `size` PROP rather than a CSS width/height — which is
 * why the call sites pass `size={n}` and keep only layout in `style`.
 *
 * Keep this export list identical to the web sibling's.
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
} from '@tamagui/lucide-icons-2'
