/**
 * input.styled.tsx — the second P2 leaf conversion: the `.input` BEM block as idiomatic Tamagui
 * `styled()` + variants (docs/tamagui-idiomatic-migration.md §4, the leaf-first order after `.btn`).
 *
 * It converts `libs/css/src/elements/forms/input/index.css` — the `.input` base + the `.input--error`
 * and `.input--sm` modifiers, expressed as Tailwind `@apply` — into ONE `styled(View, { variants })`,
 * using the `$` tokens now available on web (SPIKE A1 var-backed colors + SPIKE B Tailwind
 * space/size/type scales). `className="input input--error"` becomes `<InputFrame error>`; each
 * `@apply` line maps 1:1 through the §5 utility→prop table, so it is the SAME visual result with zero
 * Tailwind/`@apply`/`!important`.
 *
 * Landed alongside the shipped className-based Input (index.tsx) rather than replacing it: the swap +
 * CSS deletion changes web output and is per-slice harness-gated (§4). This file + its structural test
 * prove the conversion is faithful and well-formed; input-styled.test.tsx pins the variant table.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * The `.input` base + variants. Each variant key mirrors a BEM modifier; each style object is the
 * `@apply` line translated by the §5 table:
 *   .input          → base (flex, h-9, w-full, rounded-md, border-input, bg-background, px-3, py-1,
 *                      text-sm, placeholder muted-foreground, focus-visible ring, disabled 50% + no-drop)
 *   .input--error   → error       (border-destructive, focus-visible ring-destructive/30)
 *   .input--sm      → size="sm"    (h-7, text-xs, px-2)
 */
export const InputFrame = styled(View, {
  name: 'Input',
  tag: 'input',

  // .input base
  display: 'flex', // .input applies `flex!`; the `!` was only to beat a reset — plain display here
  height: '$9',
  width: '100%',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$input',
  backgroundColor: '$background',
  paddingHorizontal: '$3',
  paddingVertical: '$1',
  fontSize: '$sm',
  // placeholder:text-muted-foreground — the idiomatic Tamagui input prop (emits a ::placeholder rule
  // under the compiler; the runtime host is a `<div tag="input">` until extraction, as the button
  // proof documents for `tag`).
  placeholderTextColor: '$muted-foreground',
  // focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
  focusVisibleStyle: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: '$ring',
  },
  // disabled:cursor-not-allowed disabled:opacity-50
  disabledStyle: { opacity: 0.5, cursor: 'not-allowed' },

  variants: {
    error: {
      true: {
        borderColor: '$destructive',
        // focus-visible:ring-destructive/30 — the /30 alpha via web color-mix over runtime `--destructive`.
        focusVisibleStyle: {
          outlineColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)',
        },
      },
    },
    size: {
      default: {}, // .input already carries h-9 px-3 text-sm
      sm: { height: '$7', fontSize: '$xs', paddingHorizontal: '$2' },
    },
  } as const,

  defaultVariants: { size: 'default' },
})

export type InputSize = 'default' | 'sm'

export interface StyledInputProps extends React.ComponentProps<'input'> {
  error?: boolean
  inputSize?: InputSize
}

// Cast to a plain component type for the same react18/19 dual-types reason as the primitives
// (_tamagui.tsx typing note); the variant props are surfaced via StyledInputProps.
const Frame = InputFrame as unknown as React.ComponentType<any>

/**
 * Idiomatic Input — the `styled()` variant Input with the SAME public API as the shipped className
 * Input (elements/forms/input/index.tsx: an `error?: boolean`). `inputSize` exposes the `.input--sm`
 * BEM modifier as a prop (the shipped className Input never wired `--sm` up; it is available here).
 */
export function StyledInput({ error, inputSize = 'default', ...props }: StyledInputProps) {
  return <Frame error={error} size={inputSize} {...props} />
}
