/**
 * The action / dispatch seam — the one genuinely new thing in the renderer.
 *
 * The audit put the whole Wave-1 cost here: 19 of the catalogue's 24 elements already had
 * a renderable, mostly native-forked implementation, but `render-descriptor.tsx`
 * deliberately renders every form control INERT ("there is nothing to submit it to"), so
 * nothing in the repo had ever dispatched. This module is that something.
 *
 * ## Why dispatch is a function, not a hook
 *
 * An action can appear anywhere — a row, a bulk bar, a statcard, an `onSuccess` chained
 * off another action. If firing one required a hook, every list row would have to call a
 * variable number of hooks and React's rules would break on the first data change. So
 * {@link useDispatch} returns ONE stable async function; pending state is held by the
 * control that renders the affordance ({@link ActionButton}), which is where a spinner
 * belongs anyway.
 *
 * ## The five action kinds
 *
 *  - `{ mutate }` — resolve the input bindings from the CURRENT scope (which is what
 *    gives a row's button that row's id — audit I1), confirm if asked, call, invalidate,
 *    then run `onSuccess` against a scope where `$result.*` is the mutation's Output.
 *  - `{ navigate }` — fill the route's `[param]`s from bindings and hand it to the host
 *    router. A renderer that owned routing could not serve both targets.
 *  - `{ download }` — an ENDPOINT's Output saved to a file. Never a URL, never a Blob in
 *    the spec: the client download primitive is the renderer's, the bytes are the
 *    endpoint's.
 *  - `{ print: true }` and `{ copy }` — the two cheap host capabilities (audit A11).
 *
 * A host that supplies no `navigate`/`print`/`copyToClipboard` gets a control that
 * renders and does nothing, which is the honest behaviour for a preview host — never a
 * crash mid-page.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import type { Action, ActionItem, MutateAction, Tone } from './types'
import { isMutateAction } from './types'
import { fillRoute, resolveInputs, resolveOptional, type Scope } from './bind'
import { stringify, toneTokens } from './format'
import { useViewRuntime } from './runtime'
import { ViewIcon } from './icons'

/** Extra values only the calling control knows — a `field`'s new value, a selection. */
export interface DispatchExtras {
  /** The renderer-supplied value for `MutateAction.arg` (a control value, or a selection). */
  argValue?: unknown
  /** The selection a `over: 'selection'` bulk action commits. */
  selection?: string[]
  /** Called after a successful mutation, before `onSuccess` — e.g. to clear a selection. */
  onDone?: (result: unknown) => void
}

/** The dispatcher. Stable across renders; safe to call from anywhere in a list. */
export type Dispatch = (action: Action | undefined, scope: Scope, extras?: DispatchExtras) => Promise<void>

/**
 * Build the page's action dispatcher.
 *
 * One per component that needs it — it closes over nothing mutable, so several copies are
 * indistinguishable.
 */
export function useDispatch(): Dispatch {
  const { client, invalidate, routeParams } = useViewRuntime()

  const dispatch = React.useCallback<Dispatch>(
    async (action, scope, extras) => {
      if (!action) return

      if (isMutateAction(action)) {
        await runMutate(action, scope, extras)
        return
      }

      if ('navigate' in action) {
        const params: Record<string, unknown> = { ...routeParams }
        for (const [key, binding] of Object.entries(action.params ?? {})) {
          const v = resolveOptional(binding, scope)
          if (v !== undefined) params[key] = v
        }
        client.navigate?.(fillRoute(action.navigate, params))
        return
      }

      if ('download' in action) {
        const { values } = resolveInputs(action.input, scope)
        const { body, contentType } = await client.fetchBlob(action.download, values)
        const filename = stringify(resolveOptional(action.filename, scope) ?? `${action.download}.txt`)
        await client.saveFile?.(filename, body, contentType)
        return
      }

      if ('print' in action) {
        client.print?.()
        return
      }

      if ('copy' in action) {
        const text = stringify(resolveOptional(action.copy, scope))
        if (text) await client.copyToClipboard?.(text)
        return
      }

      // The union is closed; this makes a new action kind added upstream a typecheck
      // failure here rather than a silently dead button on a device.
      const never: never = action
      void never
    },
    // `runMutate` is declared below and closes over the same three values.
    [client, invalidate, routeParams],
  )

  async function runMutate(action: MutateAction, scope: Scope, extras?: DispatchExtras): Promise<void> {
    if (action.confirm) {
      const ok = await client.confirm(action.confirm)
      if (!ok) return
    }
    const { ready, values } = resolveInputs(action.input, scope)
    // A mutation whose arguments are not resolvable must not fire with holes in them.
    if (!ready) return

    // `over: 'selection'` and a `field`'s new value both arrive under the Input key named
    // by `arg`. There is deliberately no `$selection` / `$value` binding root — a value
    // that is not on a path is NAMED by the mutation instead.
    const supplied = action.over === 'selection' ? (extras?.selection ?? []) : extras?.argValue
    const input =
      action.arg && supplied !== undefined ? { ...values, [action.arg]: supplied } : values

    const result = await client.call(action.mutate, input)
    invalidate([action.mutate, ...(action.invalidates ?? [])])
    extras?.onDone?.(result)
    if (action.onSuccess) await dispatch(action.onSuccess, { ...scope, result })
  }

  return dispatch
}

// ── the affordances ──────────────────────────────────────────────────────────

const VARIANT_STYLE: Record<'primary' | 'secondary' | 'ghost', Record<string, unknown>> = {
  primary: { backgroundColor: '$primary', color: '$primary-foreground', borderColor: 'transparent' },
  secondary: { backgroundColor: '$background', color: '$foreground', borderColor: '$border' },
  ghost: { backgroundColor: 'transparent', color: '$foreground', borderColor: 'transparent' },
}

export interface ActionButtonProps {
  label: string
  onPress: () => void | Promise<void>
  icon?: string
  tone?: Exclude<Tone, 'auto'>
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  disabled?: boolean
}

/**
 * The one pressable affordance in the renderer.
 *
 * Holds its OWN pending state, which is why dispatch does not: a bulk bar with four
 * actions needs four independent spinners, and lifting that into the page would be one
 * `useState` per action per render.
 *
 * `Prim.Pressable` (not a `<button>`): it forks natively, and on a device a press arrives
 * through the responder system. The label is always inside a `Prim.Text` — a bare string
 * here would vanish on a phone and leave a button that looks empty.
 */
export function ActionButton({
  label,
  onPress,
  icon,
  tone,
  variant = 'secondary',
  size = 'md',
  disabled,
}: ActionButtonProps): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState<string | undefined>(undefined)

  const handle = React.useCallback(() => {
    if (pending || disabled) return
    setFailed(undefined)
    const done = onPress()
    if (done && typeof (done as Promise<void>).then === 'function') {
      setPending(true)
      void (done as Promise<void>)
        .catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))
        .finally(() => setPending(false))
    }
  }, [onPress, pending, disabled])

  const style = VARIANT_STYLE[variant]
  const color = tone && variant !== 'primary' ? toneTokens(tone).fg : (style.color as string)

  return (
    <Prim.Col gap="$1" alignItems="flex-start">
      <Prim.Pressable
        onClick={handle}
        disabled={disabled || pending}
        display="flex"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$1.5"
        borderWidth={1}
        borderRadius="$radius-md"
        paddingHorizontal={size === 'sm' ? '$2' : '$3'}
        paddingVertical={size === 'sm' ? '$1' : '$1.5'}
        opacity={pending || disabled ? 0.6 : 1}
        {...style}
        color={color}
      >
        {icon ? <ViewIcon name={icon} size="sm" color={color} /> : null}
        <Prim.Text fontSize={size === 'sm' ? '$xs' : '$sm'} fontWeight="$medium" color={color}>
          {pending ? '…' : label}
        </Prim.Text>
      </Prim.Pressable>
      {failed ? (
        <Prim.Text fontSize="$xs" color="$destructive">
          {failed}
        </Prim.Text>
      ) : null}
    </Prim.Col>
  )
}

/**
 * Render one {@link ActionItem} — a toolbar entry, a detail-header action, a bulk action,
 * a row control.
 *
 * An item does something if it has an `action`, a `reveals`, or both. Both fire; the
 * schema allows it and `blog/ArticleTakes` uses exactly that shape (reveal the panel AND
 * kick the endpoint that fills it).
 */
export function ActionItemButton({
  item,
  scope,
  extras,
  variant,
  size = 'sm',
}: {
  item: ActionItem
  scope: Scope
  extras?: DispatchExtras
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}): React.ReactElement | null {
  const dispatch = useDispatch()
  const { toggleReveal } = useViewRuntime()
  const label = stringify(resolveOptional(item.label, scope) ?? item.label)

  const onPress = React.useCallback(async () => {
    if (item.reveals?.length) toggleReveal(item.reveals)
    if (item.action) await dispatch(item.action, scope, extras)
  }, [dispatch, toggleReveal, item, scope, extras])

  if (!label) return null
  return (
    <ActionButton
      label={label}
      onPress={onPress}
      icon={item.icon}
      tone={item.tone && item.tone !== 'auto' ? item.tone : undefined}
      variant={variant ?? item.variant ?? 'secondary'}
      size={size}
    />
  )
}

/** A row of {@link ActionItem}s. Renders nothing when the list is empty. */
export function ActionRow({
  items,
  scope,
  extras,
  size = 'sm',
}: {
  items?: ActionItem[]
  scope: Scope
  extras?: DispatchExtras
  size?: 'sm' | 'md'
}): React.ReactElement | null {
  if (!items || items.length === 0) return null
  return (
    <Prim.Row gap="$2" flexWrap="wrap" alignItems="center">
      {items.map((item, i) => (
        <ActionItemButton key={i} item={item} scope={scope} extras={extras} size={size} />
      ))}
    </Prim.Row>
  )
}
