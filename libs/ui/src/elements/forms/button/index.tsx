import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Button — the idiomatic `.btn`. Renders the universal Tamagui `Prim.Pressable` (a real `<button>` at
 * runtime via `createComponent`) with the `.btn` styling applied as `$`-token style PROPS instead of a
 * className — the docs/tamagui-idiomatic-migration.md §4 swap. The prop maps below are the
 * `its retired `styled()` proof` proof's variant table verbatim; `button/index.css` is deleted (this element no
 * longer emits `btn*` classes, and its former direct callers were converted to `<Button variant=…>`).
 * `asChild` merges the styling onto the caller's single child (the codebase's only Slot use).
 */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'destructive'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

// Button forwards every extra prop onto Prim.Pressable, so it accepts the full Pressable surface
// (DOM button attrs + Tamagui style props) plus variant/size/asChild.
export type ButtonProps = Omit<Prim.PressableProps, 'size'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

// `.btn` base
const BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$2',
  borderRadius: '$radius-md',
  fontSize: '$sm',
  fontWeight: '$medium',
  height: '$9',
  paddingHorizontal: '$4',
  paddingVertical: '$2',
  cursor: 'pointer',
  borderWidth: 0,
  focusVisibleStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring', outlineOffset: 2 },
  disabledStyle: { opacity: 0.5, pointerEvents: 'none' },
} as const

const VARIANT: Record<ButtonVariant, Record<string, unknown>> = {
  primary: {
    backgroundColor: '$primary',
    color: '$primary-foreground',
    hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--primary) 90%, transparent)' },
  },
  ghost: {
    backgroundColor: 'transparent',
    hoverStyle: { backgroundColor: '$accent', color: '$accent-foreground' },
  },
  outline: {
    borderWidth: 1,
    borderColor: '$input',
    backgroundColor: '$background',
    hoverStyle: { backgroundColor: '$accent', color: '$accent-foreground' },
  },
  destructive: {
    backgroundColor: '$destructive',
    color: '#fff', // ds-lint-ok: `.btn--destructive` uses literal text-white (theme-independent), not $destructive-foreground
    hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--destructive) 90%, transparent)' },
  },
}

const SIZE: Record<ButtonSize, Record<string, unknown>> = {
  default: {},
  sm: { height: '$8', paddingHorizontal: '$3', fontSize: '$xs' },
  lg: { height: '$11', paddingHorizontal: '$8', fontSize: '$base' },
  icon: { width: '$9', height: '$9', paddingHorizontal: '$0', paddingVertical: '$0' },
}

function Button({ variant = 'primary', size = 'default', asChild = false, children, ...props }: ButtonProps) {
  const styleProps = { ...BASE, ...VARIANT[variant], ...SIZE[size] }
  // asChild: render the caller's element, merging our styling + props onto it (local Slot).
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>
    return React.cloneElement(child, { ...styleProps, ...props })
  }
  return (
    <Prim.Pressable {...(styleProps as Record<string, unknown>)} {...(props as React.HTMLAttributes<HTMLElement>)}>
      {labelled(children)}
    </Prim.Pressable>
  )
}

/**
 * Wrap bare string children in a text node.
 *
 * `Prim.Pressable` is a `View` on native, and React Native refuses a string
 * child of a View — it raises "Text strings must be rendered within a <Text>
 * component" and then DROPS the string, so `<Button><Plus /> New category
 * </Button>` renders on a device as a lone `+` with no label and no error. Every
 * call site could wrap its own label, but a button whose label vanishes on one
 * platform is the button's bug, not each caller's.
 *
 * Only strings are touched: an icon, or a caller's own `<Text>`, passes through
 * unchanged. On web this adds a `<span>`, which inherits the button's typography
 * and changes nothing visually.
 */
function labelled(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? <Prim.Text>{child}</Prim.Text> : child,
  )
}

export { Button }
