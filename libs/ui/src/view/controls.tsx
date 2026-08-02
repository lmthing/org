/**
 * The input controls, built for BOTH targets.
 *
 * These are not `elements/forms/{input,select}`. Those are excellent web controls, and
 * two of them do not survive the crossing:
 *
 *  - **`Prim.Select` has no real native implementation.** Its `.native.tsx` fork is a
 *    placeholder container (`controls.native.tsx`: "a real native picker is a follow-up"),
 *    so a `<select>` renders as a stack of inert text on a phone. Since a `create` section
 *    turns every Input-schema enum into a select, using it would mean a generated app's
 *    forms are unusable on the target this whole project exists for.
 *  - **`elements/forms/input` types its `onChange` as a DOM event.** The native fork does
 *    reconstruct `{ target: { value } }`, so it works — but the whole surface is easier to
 *    reason about with one shape.
 *
 * So the select is a disclosure over `Prim.Pressable` rows: no popover, no portal, no
 * anchored panel. That is also the audit's A16 verdict for its own reasons — "a phone has
 * no anchored-popover convention" — so the same shape serves both.
 *
 * Everything else (`Prim.TextField`, `Prim.TextArea`, `Prim.Pressable`) already forks.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import { ViewIcon, StarGlyph } from './icons'

const CONTROL = {
  borderWidth: 1,
  borderColor: '$input',
  borderRadius: '$radius-md',
  backgroundColor: '$background',
  color: '$foreground',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  fontSize: '$sm',
  minHeight: 36,
} as const

export interface TextControlProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  secure?: boolean
  numeric?: boolean
  disabled?: boolean
  id?: string
}

/** A single-line or multi-line text control. */
export function TextControl({
  value,
  onChange,
  placeholder,
  multiline,
  secure,
  numeric,
  disabled,
  id,
}: TextControlProps): React.ReactElement {
  const props = {
    ...CONTROL,
    id,
    value,
    placeholder,
    disabled,
    // The native fork translates this to `onChangeText`; the web one hands back a DOM
    // event. One shape here, both targets satisfied.
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    ...(secure ? { type: 'password' } : {}),
    ...(numeric ? { inputMode: 'decimal' as const } : {}),
  } as unknown as React.ComponentProps<typeof Prim.TextField>
  return multiline ? (
    <Prim.TextArea {...(props as unknown as React.ComponentProps<typeof Prim.TextArea>)} rows={4} minHeight={88} />
  ) : (
    <Prim.TextField {...props} />
  )
}

export interface SelectControlProps {
  value: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * A select, as a disclosure.
 *
 * Closed it is one pressable row showing the current label; open it is a list of pressable
 * rows. No portal and no measurement, so it mounts identically under jsdom and under
 * `react-test-renderer`, and a tap works on a device where a `<select>` would not.
 */
export function SelectControl({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled,
}: SelectControlProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <Prim.Col gap="$1" alignItems="stretch">
      <Prim.Pressable
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        {...CONTROL}
        display="flex"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        gap="$2"
        aria-expanded={open}
      >
        <Prim.Text fontSize="$sm" color={current ? '$foreground' : '$muted-foreground'}>
          {current?.label ?? placeholder}
        </Prim.Text>
        <ViewIcon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
      </Prim.Pressable>
      {open ? (
        <Prim.Col
          borderWidth={1}
          borderColor="$border"
          borderRadius="$radius-md"
          backgroundColor="$popover"
          maxHeight={220}
          overflow="hidden"
        >
          <Prim.Scroll maxHeight={220}>
            {options.length === 0 ? (
              <Prim.Box paddingHorizontal="$3" paddingVertical="$2">
                <Prim.Text fontSize="$sm" color="$muted-foreground">
                  No options
                </Prim.Text>
              </Prim.Box>
            ) : (
              options.map((option) => (
                <Prim.Pressable
                  key={option.value}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  paddingHorizontal="$3"
                  paddingVertical="$2"
                  backgroundColor={option.value === value ? '$accent' : 'transparent'}
                >
                  <Prim.Text fontSize="$sm" color="$popover-foreground">
                    {option.label}
                  </Prim.Text>
                </Prim.Pressable>
              ))
            )}
          </Prim.Scroll>
        </Prim.Col>
      ) : null}
    </Prim.Col>
  )
}

/** A checkbox / switch. Drawn, not native — one appearance on both targets. */
export function ToggleControl({
  value,
  onChange,
  label,
  disabled,
}: {
  value: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
}): React.ReactElement {
  return (
    <Prim.Pressable
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      display="flex"
      flexDirection="row"
      alignItems="center"
      gap="$2"
      role="checkbox"
      aria-checked={value}
    >
      <Prim.Box
        width={20}
        height={20}
        borderRadius="$radius"
        borderWidth={1}
        borderColor={value ? '$primary' : '$input'}
        backgroundColor={value ? '$primary' : '$background'}
        alignItems="center"
        justifyContent="center"
      >
        {value ? <ViewIcon name="check" size={14} color="$primary-foreground" /> : null}
      </Prim.Box>
      {label ? <Prim.Text fontSize="$sm">{label}</Prim.Text> : null}
    </Prim.Pressable>
  )
}

/** A ± stepper over a bounded number. */
export function StepperControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}): React.ReactElement {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const btn = {
    width: 28,
    height: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: '$input',
    borderRadius: '$radius-md',
    backgroundColor: '$background',
  }
  return (
    <Prim.Row gap="$2" alignItems="center">
      <Prim.Pressable onClick={() => !disabled && onChange(clamp(value - step))} disabled={disabled} {...btn}>
        <Prim.Text fontSize="$sm">−</Prim.Text>
      </Prim.Pressable>
      <Prim.Text fontSize="$sm" fontWeight="$medium" minWidth={28} textAlign="center">
        {String(value)}
      </Prim.Text>
      <Prim.Pressable onClick={() => !disabled && onChange(clamp(value + step))} disabled={disabled} {...btn}>
        <Prim.Text fontSize="$sm">+</Prim.Text>
      </Prim.Pressable>
    </Prim.Row>
  )
}

/**
 * A date control.
 *
 * `type="date"` on web (the platform picker, free); a plain ISO text field on native, because
 * RN has no date input and every date PICKER is a third-party native module — one more
 * dependency in the Metro graph for a control whose keyboard entry is already usable. The
 * value crossing the seam is an ISO `YYYY-MM-DD` string either way, so the endpoint receives
 * one shape and neither target has to know which produced it.
 */
export function DateControl({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
}): React.ReactElement {
  const props = {
    ...CONTROL,
    id,
    value,
    disabled,
    placeholder: 'YYYY-MM-DD',
    type: 'date',
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  } as unknown as React.ComponentProps<typeof Prim.TextField>
  return <Prim.TextField {...props} />
}

/**
 * A bounded slider, drawn as a track of pressable segments.
 *
 * Not a drag gesture: a real one needs `PanResponder` on native and pointer events on web —
 * two implementations of one control, which is exactly the divergence this renderer refuses.
 * Ten taps cover any range, and a tap target is also the accessible interaction.
 */
export function SliderControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}): React.ReactElement {
  const span = max - min || 1
  const stops = Math.min(20, Math.max(2, Math.round(span / (step || 1)) + 1))
  const at = Math.round(((value - min) / span) * (stops - 1))
  return (
    <Prim.Row gap="$2" alignItems="center">
      <Prim.Row gap="$0.5" flexGrow={1} flexShrink={1} flexBasis="0%" alignItems="center">
        {Array.from({ length: stops }, (_, i) => (
          <Prim.Pressable
            key={i}
            onClick={() => !disabled && onChange(min + Math.round((i / (stops - 1)) * span))}
            disabled={disabled}
            flexGrow={1}
            flexShrink={1}
            flexBasis="0%"
            height={i <= at ? 8 : 4}
            borderRadius="$radius-full"
            backgroundColor={i <= at ? '$primary' : '$secondary'}
          />
        ))}
      </Prim.Row>
      <Prim.Text fontSize="$sm" fontWeight="$medium" minWidth={36} textAlign="right">
        {String(value)}
      </Prim.Text>
    </Prim.Row>
  )
}

/**
 * A multi-select — the same disclosure shape as {@link SelectControl}, with checkable rows
 * and no "close on pick", because picking several is the point.
 */
export function MultiSelectControl({
  values,
  options,
  onChange,
  placeholder = 'Select…',
  disabled,
}: {
  values: string[]
  options: { label: string; value: string }[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const chosen = options.filter((o) => values.includes(o.value))
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
  return (
    <Prim.Col gap="$1">
      <Prim.Pressable
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        display="flex"
        flexDirection="row"
        alignItems="center"
        gap="$2"
        {...CONTROL}
      >
        <Prim.Text fontSize="$sm" color={chosen.length ? '$foreground' : '$muted-foreground'} flexGrow={1}>
          {chosen.length ? chosen.map((o) => o.label).join(', ') : placeholder}
        </Prim.Text>
        <ViewIcon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
      </Prim.Pressable>
      {open ? (
        <Prim.Col borderWidth={1} borderColor="$border" borderRadius="$radius-md" backgroundColor="$card">
          {options.map((o) => {
            const on = values.includes(o.value)
            return (
              <Prim.Pressable
                key={o.value}
                onClick={() => toggle(o.value)}
                display="flex"
                flexDirection="row"
                alignItems="center"
                gap="$2"
                paddingHorizontal="$3"
                paddingVertical="$2"
              >
                <ViewIcon name={on ? 'check' : 'close'} size="sm" tone={on ? 'success' : 'neutral'} />
                <Prim.Text fontSize="$sm" color="$foreground">
                  {o.label}
                </Prim.Text>
              </Prim.Pressable>
            )
          })}
        </Prim.Col>
      ) : null}
    </Prim.Col>
  )
}

/** An editable star rating. The read-only twin is the `rating` element. */
export function RatingControl({
  value,
  onChange,
  max = 5,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  max?: number
  disabled?: boolean
}): React.ReactElement {
  return (
    <Prim.Row gap="$1" alignItems="center" role="radiogroup">
      {Array.from({ length: max }, (_, i) => (
        <Prim.Pressable
          key={i}
          onClick={() => !disabled && onChange(i + 1)}
          disabled={disabled}
          aria-label={`${i + 1}`}
        >
          <StarGlyph filled={i < value} size={18} />
        </Prim.Pressable>
      ))}
    </Prim.Row>
  )
}

/** A labelled control row — the one place a form field's label and hint are composed. */
export function Labelled({
  label,
  required,
  hint,
  error,
  children,
}: {
  label?: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Prim.Col gap="$1.5">
      {label ? (
        <Prim.Row gap="$1" alignItems="center">
          <Prim.Text fontSize="$xs" fontWeight="$medium" color="$muted-foreground">
            {label}
          </Prim.Text>
          {required ? (
            <Prim.Text fontSize="$xs" color="$destructive">
              *
            </Prim.Text>
          ) : null}
        </Prim.Row>
      ) : null}
      {children}
      {hint ? (
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {hint}
        </Prim.Text>
      ) : null}
      {error ? (
        <Prim.Text fontSize="$xs" color="$destructive">
          {error}
        </Prim.Text>
      ) : null}
    </Prim.Col>
  )
}
