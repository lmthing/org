/**
 * The `.field-tree-node*` / `.field-tree-context-menu*` rules the SWEEP could not take, migrated by
 * hand. Three shapes defeat it: a `:hover .child` reveal (→ a Tamagui hover group), a `--selected`
 * modifier that also RE-STATES the hover background so hover cannot win, and `--selected .child`
 * descendant recolours (→ the colour is passed down as a prop, since `isSelected` is in scope at
 * every call site). The `--option`/`--field`/`--domain` modifiers had no rules at all and are
 * dropped. `.react-arborist*` stays in `FieldTree.css`: that markup belongs to the library.
 *
 * Separate from the generated `field-tree.props.ts` (which is sweep output and must not be
 * hand-edited), and exported through `@lmthing/ui/studio` because the `$fieldId` route in
 * `apps/web` renders its own node rows against the same rules.
 *
 * See docs/tamagui-idiomatic-migration.md §5.
 */
import { FIELD_TREE_CONTEXT_MENU_ITEM_DESTRUCTIVE, FIELD_TREE_CONTEXT_MENU_ITEM_ICON } from './field-tree.props.js'

export const FIELD_TREE_NODE = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  paddingHorizontal: '0.625rem',
  height: '100%',
  borderRadius: '0.375rem',
  cursor: 'pointer',
  position: 'relative',
  hoverStyle: { backgroundColor: 'var(--color-muted)' },
} as const

/** `--selected` also pins `hoverStyle`, mirroring the `--selected:hover` rule that re-stated it. */
export const FIELD_TREE_NODE_SELECTED = {
  backgroundColor: 'var(--color-primary)',
  color: 'var(--color-primary-foreground)',
  hoverStyle: { backgroundColor: 'var(--color-primary)' },
} as const

/** What `.field-tree-node--selected .field-tree-node__{label,icon--*}` used to do. */
export const FIELD_TREE_NODE_CHILD_SELECTED = { color: 'var(--color-primary-foreground)' } as const

/** `.field-tree-node__actions` + the `:hover` reveal, as a Tamagui hover group. */
export const FIELD_TREE_NODE_ACTIONS = { opacity: 0, '$group-node-hover': { opacity: 1 } } as const

/** Spread onto the row that OWNS the reveal. Cast: `group` is not in the primitives' prop types. */
export const FIELD_TREE_NODE_GROUP = { group: 'node' } as Record<string, unknown>

export const FIELD_TREE_CONTEXT_MENU = {
  position: 'fixed',
  zIndex: 50,
  minWidth: 180,
  backgroundColor: 'var(--color-card)',
  borderRadius: '0.75rem',
  borderWidth: 1,
  borderColor: 'var(--color-border)',
  overflow: 'hidden',
  shadowColor: 'rgba(0,0,0,0.25)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 25 },
  shadowRadius: 50,
} as const

export const FIELD_TREE_CONTEXT_MENU_ITEM = {
  width: '100%',
  paddingVertical: '0.625rem',
  paddingHorizontal: '1rem',
  textAlign: 'left',
  fontSize: '0.875rem',
  color: 'var(--color-foreground)',
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  cursor: 'pointer',
  borderWidth: 0,
  backgroundColor: 'transparent',
  hoverStyle: { backgroundColor: 'var(--color-muted)' },
} as const

export const FIELD_TREE_CONTEXT_MENU_ITEM_DESTRUCTIVE_HOVER = {
  ...FIELD_TREE_CONTEXT_MENU_ITEM_DESTRUCTIVE,
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)' },
} as const

/** The `--destructive .item-icon` descendant recolour. */
export const FIELD_TREE_CONTEXT_MENU_ITEM_ICON_DESTRUCTIVE = {
  ...FIELD_TREE_CONTEXT_MENU_ITEM_ICON,
  color: 'var(--color-destructive)',
} as const
