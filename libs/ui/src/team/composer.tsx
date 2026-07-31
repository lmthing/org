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
import { AppIcon, CloseIcon, FileIcon, PlusIcon, SendIcon } from './icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isWeb } from '@tamagui/core'
import type { Directory, MemberProfile, ChannelAttachment } from './types'
import { initials, memberLabel } from './format'

/** How tall the composer grows before it scrolls instead. */
const MAX_COMPOSER_HEIGHT = 180

/** Mirrors the pod's own cap (`libs/cli/src/server/routes/uploads.ts#MAX_UPLOAD_BYTES`) so a file
 *  picked too big is refused immediately, filename and all — rather than after a full base64
 *  upload comes back a bare 413. The pod is still the one that actually enforces this; this is
 *  purely a faster, friendlier no, and the one place a rejected upload MUST be visible rather than
 *  silently swallowed (see `attachError` below). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Mirrors the pod's own cap (`routes/team-channels.ts#MAX_MESSAGE_ATTACHMENTS`). The pod does
 *  not reject a post over this — it silently `.slice(0, 10)`s the id list — so this is the one
 *  place refusing early actually matters: without it, an 11th file would upload successfully,
 *  sit in the composer looking staged and ready, and then vanish on send with no error at all. */
const MAX_ATTACHMENTS_PER_MESSAGE = 10

/** File types the attach picker accepts — mirrors `chat/app/Composer.tsx#ATTACH_ACCEPT`
 *  (duplicated rather than imported: the two composers are independent surfaces, and this list
 *  only shapes the OS picker — the server accepts any type regardless). Images/audio, plus every
 *  document type the system-files reader can extract host-side. */
const ATTACH_ACCEPT = [
  'image/*',
  'audio/*',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-excel',
  '.md,.csv,.tsv,.docx,.pptx,.xlsx,.xls,.odt,.odp,.ods',
].join(',')

/** Read a browser `File` as a base64 data URL — `TeamClient.uploadAttachment` accepts the
 *  `data:<mime>;base64,` form and strips the prefix server-side. Web-only by construction
 *  (`FileReader` is a DOM API); every caller of this is already behind an `isWeb`/`onUpload` gate. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

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
  onSend: (text: string, attachments?: ChannelAttachment[]) => Promise<void> | void
  /**
   * Upload one picked/pasted/dropped file, returning the staged ref this composer holds until
   * send — wired to `TeamClient.uploadAttachment` by the caller (`channels-view.tsx`).
   *
   * Web-only in effect, not just in principle: without it (native, or a test harness with nothing
   * to upload to) the attach control, paste-to-attach and drag-and-drop are simply ABSENT rather
   * than present-but-broken. `<input type="file">` has no React Native equivalent — a bare
   * `TextInput` under the hood, so an ungated button would sit there doing nothing on a phone,
   * which is exactly the "silently show a dead button" failure to avoid. Optional for the same
   * reason `onPrefillApplied` is: existing unit tests mount `Composer` with no upload wiring at
   * all and must keep working.
   */
  onUpload?: (input: { filename?: string; mediaType: string; data: string }) => Promise<ChannelAttachment>
  /**
   * Turn a staged/sent attachment's `url` into something an `<img>` can actually load — wired to
   * `TeamClient.attachmentUrl`. Identity when omitted, which only matters for the staged-preview
   * thumbnail below (a sent message's own rendering resolves through `MessageContext` instead).
   */
  resolveUrl?: (url: string) => string
  /**
   * Text to drop into the box and focus — how a suggestion elsewhere on the surface ("Ask THING")
   * hands the member a half-written message instead of sending one for them. Cleared by the caller
   * through `onPrefillApplied`, so the same suggestion can be offered twice.
   */
  prefill?: string | null
  onPrefillApplied?: () => void
}

export function Composer({
  placeholder,
  directory,
  meId,
  disabled,
  onTyping,
  onSend,
  onUpload,
  resolveUrl = (url) => url,
  prefill,
  onPrefillApplied,
}: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<ChannelAttachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const uploadOne = useCallback(
    async (file: File): Promise<void> => {
      if (!onUpload) return
      const data = await readAsDataUrl(file)
      const staged = await onUpload({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
      })
      setAttachments((prev) => [...prev, staged])
    },
    [onUpload],
  )

  /** Upload one or more files onto the pending message — the picker, a paste, or a drop all funnel
   *  here. Size-checked up front (see {@link MAX_ATTACHMENT_BYTES}) so a too-big file is refused
   *  before spending a base64 round trip on something the pod would 413 anyway. */
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || !onUpload) return
      if (attachments.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setAttachError(`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`)
        return
      }
      const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_BYTES)
      if (tooBig) {
        setAttachError(`"${tooBig.name}" is over the 25MB attachment limit`)
        return
      }
      setAttaching(true)
      setAttachError(null)
      try {
        for (const file of files) await uploadOne(file)
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : String(err))
      } finally {
        setAttaching(false)
      }
    },
    [onUpload, uploadOne, attachments.length],
  )

  const removeAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  )

  const suggestions = useMemo(
    () => (mention ? suggestionsFor(mention.query, directory, meId) : []),
    [mention, directory, meId],
  )
  const open = suggestions.length > 0

  // Reset the cursor whenever the candidate list changes underneath it, so the
  // highlight can never point past the end of the list.
  useEffect(() => setHighlighted(0), [mention?.query])

  // A prefill is a suggestion, not a send: the text lands in the box with the caret after it and
  // the member decides what to do with it. Appended rather than assigned, so tapping a suggestion
  // never eats something already half-typed.
  useEffect(() => {
    if (!prefill) return
    setDraft((current) => (current ? `${current.replace(/\s*$/, '')} ${prefill}` : prefill))
    // OPTIONAL-called rather than web-guarded: a React Native `TextInput` instance has `focus()`
    // too, and on a phone the point of a suggestion is that you can carry on typing — landing the
    // text without raising the keyboard makes the member tap the box themselves.
    ;(ref.current as { focus?: () => void } | null)?.focus?.()
    onPrefillApplied?.()
    // `onPrefillApplied` is the caller's reset and would re-run this on every render if depended on.
  }, [prefill])

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
    // The pod requires text on every post, attachments or not
    // (`routes/team-channels.ts#handlePostMessage`) — there is no attachment-only message on this
    // surface, so this stays a hard requirement rather than something the composer could relax on
    // its own; sending a bare photo with no caption is one word away ("👍", "see attached") rather
    // than genuinely unreachable.
    if (!text || attaching) return
    const pending = attachments
    setDraft('')
    setMention(null)
    setAttachments([])
    setAttachError(null)
    requestAnimationFrame(grow)
    try {
      await onSend(text, pending.length ? pending : undefined)
    } catch {
      // Put it back rather than losing what somebody wrote, or uploaded.
      setDraft(text)
      setAttachments(pending)
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
        // The rail (`rail.tsx#RailPane`) and the compact drawer (`channels-view.tsx`) both close
        // on Escape now, via the same `document`-level seam `Drawer`/`Dialog` already used
        // (`platform/keyboard#onDismiss`). Without `stopPropagation` this keydown reaches that
        // listener too — so dismissing the picker while replying in an open thread would ALSO
        // throw the whole rail closed, one keystroke after the member only meant to close the
        // picker.
        e.stopPropagation()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  // Paste-to-attach: a pasted image/file has no text form, so there is nothing for the textarea's
  // own paste handling to do with it — hand it straight to the same upload path the picker uses.
  // Web-only: `ClipboardEvent`/`DataTransfer` are DOM concepts `nativeSafeProps` does not forward,
  // so on native this prop is simply never passed (see the spread at the call site).
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    void handleFiles(files)
  }

  // Drag-and-drop, same reasoning as paste: cheap on web, meaningless on a touch device with
  // nothing to drag from. `onDrop`/`onDragOver` are DOM-only and dropped by `nativeSafeProps`
  // regardless, but gating explicitly keeps `dragOver` (and the overlay it drives) from ever being
  // true on native, where there is no drag gesture to end it.
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (onUpload) setDragOver(true)
  }
  const onDragLeave = () => setDragOver(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    void handleFiles(Array.from(e.dataTransfer?.files ?? []))
  }

  const canAttach = isWeb && !!onUpload

  return (
    <Prim.Box
      position="relative"
      {...(canAttach ? { onDragOver, onDragLeave, onDrop } : {})}
    >
      {open ? (
        <MentionPicker
          suggestions={suggestions}
          highlighted={highlighted}
          onHover={setHighlighted}
          onPick={accept}
        />
      ) : null}
      {/* A drop target that covers the composer while a drag is over it — not a border on the
          textarea itself, which would shift its content and read as a layout bug rather than a
          hint. */}
      {dragOver ? (
        <Prim.Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          zIndex={30}
          borderWidth={2}
          borderStyle="dashed"
          borderColor="$primary"
          borderRadius="$radius-md"
          backgroundColor="color-mix(in srgb, var(--primary) 8%, transparent)"
          display="flex"
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
        >
          <Prim.Text fontSize="$sm" fontWeight="$medium" color="$primary">
            Drop to attach
          </Prim.Text>
        </Prim.Box>
      ) : null}
      {attachments.length > 0 || attaching || attachError ? (
        <StagedAttachments
          attachments={attachments}
          attaching={attaching}
          error={attachError}
          resolveUrl={resolveUrl}
          onRemove={removeAttachment}
        />
      ) : null}
      <Prim.Row
        gap="$2"
        padding="$3"
        borderTopWidth={1}
        borderColor="$border"
        alignItems="flex-end"
      >
        {canAttach ? (
          <AttachButton
            disabled={(disabled ?? false) || attaching}
            fileRef={fileRef}
            onFiles={(files) => void handleFiles(files)}
          />
        ) : null}
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
          // Web only: opening a channel or thread otherwise needs a click on the box before typing
          // — a real cost on a surface whose whole point is replying quickly. Not on native: an RN
          // `TextInput`'s `autoFocus` pops the keyboard the instant the screen mounts, which on a
          // phone is a surprise, not a convenience, the moment you are just reading a channel.
          {...(isWeb ? { autoFocus: true, onPaste } : {})}
        />
        <Button size="icon" onClick={() => void submit()} disabled={!draft.trim() || attaching}>
          <SendIcon size={14} />
        </Button>
      </Prim.Row>
    </Prim.Box>
  )
}

/**
 * The attach control: a plus (not a paperclip — see `chat/app/Composer.tsx`'s own note on the
 * same choice), sized `44px` on the base scale and shrinking to `28px` once a mouse is likely
 * (`$md`), matching the touch-target fix the rest of this composer's controls got in round 1.
 *
 * Web-only by construction — see `ComposerProps.onUpload`. The hidden `<input type="file">` is
 * the one place this surface reaches for a raw DOM control; there is no primitive for it because
 * there is no React Native equivalent to have one.
 */
function AttachButton({
  disabled,
  fileRef,
  onFiles,
}: {
  disabled: boolean
  fileRef: React.RefObject<HTMLInputElement>
  onFiles: (files: File[]) => void
}) {
  return (
    <Prim.Text
      as="label"
      {...(disabled ? { opacity: 0.5, pointerEvents: 'none' as const } : {})}
      transition="quick"
      animateOnly={['color', 'background-color', 'border-color']}
      flexShrink={0}
      width="$11"
      height="$11"
      $md={{ width: '$7', height: '$7' }}
      borderRadius="$radius-lg"
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="$muted-foreground"
      cursor="pointer"
      hoverStyle={{ color: '$foreground' }}
      title="Add an image, audio, or file to your message"
    >
      <PlusIcon size={14} />
      <Prim.TextField
        ref={fileRef}
        type="file"
        accept={ATTACH_ACCEPT}
        multiple
        display="none"
        data-testid="attach-input"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          if (fileRef.current) fileRef.current.value = ''
        }}
      />
    </Prim.Text>
  )
}

/** The staged attachments row — above the input, cleared on send or on remove. */
function StagedAttachments({
  attachments,
  attaching,
  error,
  resolveUrl,
  onRemove,
}: {
  attachments: ChannelAttachment[]
  attaching: boolean
  error: string | null
  resolveUrl: (url: string) => string
  onRemove: (id: string) => void
}) {
  return (
    <Prim.Row paddingHorizontal="$3" paddingTop="$3" flexWrap="wrap" gap="$3" alignItems="center">
      {attachments.map((a) => (
        <Prim.Row
          key={a.id}
          alignItems="center"
          gap="$1.5"
          maxWidth={220}
          borderRadius="$radius-lg"
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$muted"
          paddingHorizontal="$2"
          paddingVertical="$1"
        >
          {a.kind === 'image' ? (
            <Prim.Image
              src={resolveUrl(a.url)}
              alt={a.filename ?? 'image'}
              width={24}
              height={24}
              borderRadius="$radius-sm"
              objectFit="cover"
            />
          ) : (
            <FileIcon size={12} />
          )}
          <Prim.Text
            fontSize="$xs"
            color="$foreground"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {a.filename ?? a.kind}
          </Prim.Text>
          <Prim.Pressable
            onClick={() => onRemove(a.id)}
            flexShrink={0}
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="$muted-foreground"
            hoverStyle={{ color: '$foreground' }}
            aria-label={`Remove ${a.filename ?? 'attachment'}`}
            // 44px hit area around an 11px glyph, the same `rail.tsx` unpin-control shape: the
            // negative margin grows the invisible touch target without inflating the visible chip.
            width={44}
            height={44}
            margin="-$4"
          >
            <CloseIcon size={11} />
          </Prim.Pressable>
        </Prim.Row>
      ))}
      {attaching ? <Caption>Uploading…</Caption> : null}
      {error ? (
        <Prim.Text fontSize="$xs" color="$destructive">
          {error}
        </Prim.Text>
      ) : null}
    </Prim.Row>
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
      shadowColor="color-mix(in srgb, var(--foreground) 12%, transparent)"
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
