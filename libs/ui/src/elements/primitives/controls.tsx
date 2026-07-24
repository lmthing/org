/**
 * Form-control primitives — `<input>`, `<textarea>`, `<select>`, `<option>`.
 *
 * `TextField`/`TextArea`/`Select` are real Tamagui components built per-tag with
 * `createComponent({ isInput: true })` (see `_tamagui.tsx`), so the REAL host element and its form
 * behaviour are runtime-guaranteed while the control also accepts the full Tamagui style-prop
 * surface + `placeholderTextColor`. That is what lets `elements/forms/{input,textarea,select}` carry
 * their design tokens as PROPS instead of a BEM className (P4 — docs/tamagui-idiomatic-migration.md
 * §6). Refs still forward, which form controls depend on for focus/measure.
 *
 * `Option` stays a pure host passthrough: it is never styled, and wrapping an `<option>` would only
 * risk its parent-`<select>` semantics.
 *
 * The `.native.tsx` fork maps these to RN `TextInput`/picker (§4).
 */
import type * as React from 'react'
import { hostPrimitive } from './_host'

export {
  TextField,
  type TextFieldPrimitiveProps as TextFieldProps,
  TextArea,
  type TextAreaPrimitiveProps as TextAreaProps,
  Select,
  type SelectPrimitiveProps as SelectProps,
  type ControlStyleProps,
} from './_tamagui'

export type OptionProps = React.OptionHTMLAttributes<HTMLOptionElement>
export const Option = hostPrimitive<HTMLOptionElement, OptionProps>('option', 'Option')
