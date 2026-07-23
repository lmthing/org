import * as React from 'react'
import { hostPrimitive } from './_host'

/**
 * Form-control passthrough primitives (Phase 0): `<input>`, `<textarea>`, `<select>`,
 * `<option>`. Pure `forwardRef` passthroughs — byte-identical HTML AND ref-forwarding (form
 * controls are frequently ref'd for focus/measure). Phase 1 swaps internals to Tamagui
 * `Input`/`TextArea`/`Select` themed to match, and RN `TextInput`/picker on native (§4).
 *
 * (Distinct from the styled `elements/forms/{input,textarea,select}` components, which add
 * design-system classes; these primitives add nothing so the de-HTML stays byte-identical.)
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement>
export const TextField = hostPrimitive<HTMLInputElement, TextFieldProps>('input', 'TextField')

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>
export const TextArea = hostPrimitive<HTMLTextAreaElement, TextAreaProps>('textarea', 'TextArea')

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>
export const Select = hostPrimitive<HTMLSelectElement, SelectProps>('select', 'Select')

export type OptionProps = React.OptionHTMLAttributes<HTMLOptionElement>
export const Option = hostPrimitive<HTMLOptionElement, OptionProps>('option', 'Option')
