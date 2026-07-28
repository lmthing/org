/**
 * The composer, and the `@` picker over it.
 *
 * `@` on this surface does not mean "a person" — it means "address something in
 * this team", and THING, a colleague and a project are three answers to the same
 * question. So one picker offers all three, in that order of usefulness: THING
 * is what a member reaches for most, a teammate next, a project last (a project
 * mention is a link into the app rail rather than something that gets notified).
 */

import * as Prim from '../elements/primitives/index'
import { Textarea } from '../elements/forms/textarea'
import { Button } from '../elements/forms/button'
import { Avatar, AvatarFallback } from '../elements/content/avatar'
import { Caption } from '../elements/typography/caption'
import { AppIcon, SendIcon } from './icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isWeb } from '@tamagui/core'
import type { Directory, MemberProfile } from './types'
import { initials, memberLabel } from './format'

/** How tall the composer grows before it scrolls instead. */
const MAX_COMPOSER_HEIGHT = 180

type Suggestion =
  | { kind: 'thing'; token: string; label: string; detail: string }
  | { kind: 'member'; token: string; label: string; detail: string; member: MemberProfile }
  | { kind: 'project'; token: string; label: string; detail: string }

/**
 * The `@…` the caret is currently inside, if any.
 *
 * Anchored to a word boundary so an email address does not open the picker
 * halfway through someone's domain, and closed by whitespace so a finished
 * mention stops matching as soon as the member types past it.
 */
function activeMention(value: string, caret: number): { query: string; start: number } | null {
  const upto = value.slice(0, caret)
  const match = /(?:^|\s)@([a-zA-Z0-9._-]*)$/.exec(upto)
  if (!match) return null
  return { query: match[1] ?? '', start: caret - (match[1] ?? '').length - 1 }
}

function suggestionsFor(
  query: string,
  directory: Directory,
  meId: string,
): Suggestion[] {
  const q = query.toLowerCase()
  const matches = (...fields: Array<string | undefined>) =>
    !q || fields.some((f) => f?.toLowerCase().includes(q))

  const out: Suggestion[] = []
  if (matches('thing')) {
    out.push({ kind: 'thing', token: 'thing', label: 'THING', detail: 'Ask the agent in a thread' })
  }
  for (const member of directory.members) {
    // Someone with no handle cannot be typed, so offering them would produce a
    // mention that resolves to nothing. They still appear in the DM list.
    if (!member.handle || member.userId === meId) continue
    if (!matches(member.handle, member.displayName, member.email)) continue
    out.push({
      kind: 'member',
      token: member.handle,
      label: memberLabel(member, member.handle),
      detail: `@${member.handle}`,
      member,
    })
  }
  for (const project of directory.projects) {
    if (!project.hasApp || !matches(project.id, project.name)) continue
    out.push({ kind: 'project', token: project.id, label: project.name, detail: 'Open the app' })
  }
  return out.slice(0, 8)
}

export interface ComposerProps {
  placeholder: string
  directory: Directory
  meId: string
  disabled?: boolean
  /** Called on every change, so the pod can tell the others someone is typing. */
  onTyping?: () => void
  onSend: (text: string) => Promise<void> | void
}

export function Composer({
  placeholder,
  directory,
  meId,
  disabled,
  onTyping,
  onSend,
}: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  const suggestions = useMemo(
    () => (mention ? suggestionsFor(mention.query, directory, meId) : []),
    [mention, directory, meId],
  )
  const open = suggestions.length > 0

  // Reset the cursor whenever the candidate list changes underneath it, so the
  // highlight can never point past the end of the list.
  useEffect(() => setHighlighted(0), [mention?.query])

  // Auto-growing the box is done by measuring it, which only a DOM node can do: `style` and
  // `scrollHeight` are both absent on a React Native host instance, so an unguarded assignment
  // throws on the first keystroke. Native gets a fixed-height composer instead — RN's `TextInput`
  // grows on its own with `multiline`, and wiring that is its own change.
  const grow = useCallback(() => {
    const el = ref.current
    if (!el || !isWeb) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [])

  // A caret moved by arrow keys or a click changes which mention (if any) is being typed, without
  // changing the text at all.
  //
  // Read off the REF, never off the event. `nativeSafeProps` maps `onClick` to `onPress` and calls
  // it with an EMPTY object — there is no DOM event on native to hand over — so the previous
  // `e.target.value` here threw `Cannot read property 'value' of undefined` the moment anyone
  // tapped the composer on a phone, before typing a single character. Nothing in a shared surface
  // may read a synthesised event's contents; the ref is the same element, and it is real on web.
  const syncCaret = useCallback(() => {
    const el = ref.current
    if (!el || !isWeb) return
    setMention(activeMention(el.value, el.selectionStart ?? el.value.length))
  }, [])

  const change = (value: string, caret: number) => {
    setDraft(value)
    setMention(activeMention(value, caret))
    grow()
    onTyping?.()
  }

  const accept = (suggestion: Suggestion) => {
    if (!mention) return
    const before = draft.slice(0, mention.start)
    const after = draft.slice(mention.start + mention.query.length + 1)
    const next = `${before}@${suggestion.token}${after.startsWith(' ') ? '' : ' '}${after}`
    setDraft(next)
    setMention(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const caret = before.length + suggestion.token.length + 2
      el.focus()
      // `focus()` exists on both hosts; `setSelectionRange` is DOM-only — an RN `TextInput`
      // spells it `setSelection` — so this is optional-called rather than assumed. Native just
      // leaves the caret where it was, which is where the accepted mention ends anyway.
      el.setSelectionRange?.(caret, caret)
      grow()
    })
  }

  const submit = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setMention(null)
    requestAnimationFrame(grow)
    try {
      await onSend(text)
    } catch {
      // Put it back rather than losing what somebody wrote.
      setDraft(text)
      requestAnimationFrame(grow)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      // While the picker is up it owns the arrows, Enter and Tab — the same keys
      // the composer wants, which is why this returns instead of falling through.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(suggestions[highlighted] ?? suggestions[0]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Prim.Box position="relative">
      {open ? (
        <MentionPicker
          suggestions={suggestions}
          highlighted={highlighted}
          onHover={setHighlighted}
          onPick={accept}
        />
      ) : null}
      <Prim.Row
        gap="$2"
        padding="$3"
        borderTopWidth={1}
        borderColor="$border"
        alignItems="flex-end"
      >
        <Textarea
          ref={ref}
          value={draft}
          disabled={disabled ?? false}
          onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          placeholder={placeholder}
          flex={1}
          rows={1}
          minHeight="$9"
          resize="none"
          onKeyDown={onKeyDown}
        />
        <Button size="icon" onClick={() => void submit()} disabled={!draft.trim()}>
          <SendIcon size={14} />
        </Button>
      </Prim.Row>
    </Prim.Box>
  )
}

function MentionPicker({
  suggestions,
  highlighted,
  onHover,
  onPick,
}: {
  suggestions: Suggestion[]
  highlighted: number
  onHover: (i: number) => void
  onPick: (s: Suggestion) => void
}) {
  return (
    <Prim.Col
      position="absolute"
      bottom="100%"
      left="$3"
      right="$3"
      maxWidth={380}
      marginBottom="$1"
      zIndex={40}
      overflow="hidden"
      borderWidth={1}
      borderColor="$border"
      borderRadius="$radius-md"
      backgroundColor="$popover"
      padding="$1"
      shadowColor="rgba(0,0,0,0.12)"
      shadowOffset={{ width: 0, height: 4 }}
      shadowRadius={10}
    >
      {suggestions.map((s, i) => (
        <Prim.Row
          key={`${s.kind}:${s.token}`}
          alignItems="center"
          gap="$2"
          paddingVertical="$1.5"
          paddingHorizontal="$2"
          borderRadius="$radius-sm"
          cursor="pointer"
          backgroundColor={i === highlighted ? '$muted' : 'transparent'}
          onMouseEnter={() => onHover(i)}
          // Branched, because the two targets need genuinely different events here.
          //
          // Web wants `onMouseDown`, not `onClick`: a click would first blur the textarea, and the
          // picker unmounts on blur before the click ever lands. But `onMouseDown` is a DOM-only
          // handler and `nativeSafeProps` DROPS it, so on a phone these rows had no press handler
          // at all — tapping a suggestion did nothing whatsoever, silently. `onPress` is the native
          // event, and it is not spread on web, where Tamagui would map it back to a click and pick
          // the suggestion twice.
          {...(isWeb
            ? {
                onMouseDown: (e: React.MouseEvent) => {
                  e.preventDefault()
                  onPick(s)
                },
              }
            : { onPress: () => onPick(s) })}
        >
          <SuggestionIcon suggestion={s} />
          <Prim.Text fontSize="$sm" flex={1} minWidth={0}>
            {s.label}
          </Prim.Text>
          <Caption>{s.detail}</Caption>
        </Prim.Row>
      ))}
    </Prim.Col>
  )
}

function SuggestionIcon({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.kind === 'thing') {
    return (
      <Prim.Text
        backgroundColor="color-mix(in srgb, var(--brand-2) 20%, transparent)"
        width="$6"
        height="$6"
        borderRadius="$radius-full"
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontSize="$xs"
        flexShrink={0}
        aria-hidden="true"
      >
        ✦
      </Prim.Text>
    )
  }
  if (suggestion.kind === 'project') {
    return (
      <Prim.Box
        width="$6"
        height="$6"
        borderRadius="$radius-sm"
        backgroundColor="$muted"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <AppIcon size={12} />
      </Prim.Box>
    )
  }
  return (
    <Avatar size="sm">
      <AvatarFallback colorKey={suggestion.member.userId}>
        {initials(suggestion.label)}
      </AvatarFallback>
    </Avatar>
  )
}
