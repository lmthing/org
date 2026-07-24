/**
 * button.styled.tsx — the P2 proof: the `.btn` BEM block as idiomatic Tamagui `styled()` + variants
 * (docs/tamagui-idiomatic-migration.md §4). This is the canonical example the plan names.
 *
 * It converts `libs/css/src/elements/forms/button/index.css` — the `.btn` base + `.btn--primary`
 * /`--ghost`/`--outline`/`--destructive` and `--sm`/`--lg`/`--icon` modifiers, expressed as Tailwind
 * `@apply` — into ONE `styled(View, { variants })`, using the `$` tokens now available on web
 * (SPIKE A1 var-backed colors + SPIKE B Tailwind space/size/type scales). `className="btn btn--primary"`
 * becomes `<ButtonFrame variant="primary">`; the `@apply` lines map 1:1 through the §5 utility→prop
 * table, so it is the SAME visual result with zero Tailwind/`@apply`/`!important`.
 *
 * Landed alongside the shipped className-based Button (index.tsx) rather than replacing it: the swap +
 * CSS deletion changes web output and is per-slice harness-gated (§4). This file + its structural test
 * prove the conversion is faithful and well-formed; button-styled.test.tsx pins the variant table.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * The `.btn` base + variants. Each variant key mirrors a BEM modifier; each style object is the
 * `@apply` line translated by the §5 table:
 *   .btn                → base (inline-flex, items/justify-center, gap-2, rounded-md, text-sm,
 *                          font-medium, h-9, px-4, py-2, focus-visible ring, disabled opacity)
 *   .btn--primary       → variant="primary"     (bg-primary, text-primary-foreground, hover 90%)
 *   .btn--ghost         → variant="ghost"        (hover bg-accent / text-accent-foreground)
 *   .btn--outline       → variant="outline"      (border-input, bg-background, hover accent)
 *   .btn--destructive   → variant="destructive"  (bg-destructive, text-white, hover 90%)
 *   .btn--sm/--lg/--icon → size="sm|lg|icon"     (h-8/px-3/text-xs · h-11/px-8/text-base · size-9/p-0)
 */
export const ButtonFrame = styled(View, {
  name: 'Button',
  tag: 'button',

  // .btn base
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
  // focus-visible:outline-none + ring-2 ring-ring ring-offset-2
  focusVisibleStyle: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: '$ring',
    outlineOffset: 2,
  },
  // disabled:pointer-events-none disabled:opacity-50
  disabledStyle: { opacity: 0.5, pointerEvents: 'none' },

  variants: {
    variant: {
      primary: {
        backgroundColor: '$primary',
        color: '$primary-foreground',
        // hover:bg-primary/90 — the /90 alpha via web color-mix over the runtime `--primary`.
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
        color: '#fff',
        hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--destructive) 90%, transparent)' },
      },
    },
    size: {
      default: {}, // .btn already carries h-9 px-4 py-2
      sm: { height: '$8', paddingHorizontal: '$3', fontSize: '$xs' },
      lg: { height: '$11', paddingHorizontal: '$8', fontSize: '$base' },
      icon: { width: '$9', height: '$9', paddingHorizontal: '$0', paddingVertical: '$0' },
    },
  } as const,

  defaultVariants: { variant: 'primary', size: 'default' },
})

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'destructive'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

export interface StyledButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

// Cast to a plain component type for the same react18/19 dual-types reason as the primitives
// (_tamagui.tsx typing note); the variant props are surfaced via StyledButtonProps.
const Frame = ButtonFrame as unknown as React.ComponentType<any>

/**
 * Idiomatic Button — the `styled()` variant Button with the SAME public API as the shipped
 * className Button. `asChild` merges variant styling onto the caller's child (the codebase's only
 * Slot use), keeping parity with elements/forms/button/index.tsx.
 */
export function StyledButton({ variant = 'primary', size = 'default', asChild = false, children, ...props }: StyledButtonProps) {
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>
    return React.cloneElement(child, { ...props })
  }
  return (
    <Frame variant={variant} size={size} {...props}>
      {children}
    </Frame>
  )
}
