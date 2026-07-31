import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { isWeb } from '@tamagui/core';
import { cn } from '../lib/cn';
import { useStore } from '../store/store';
import type { UploadedAttachment } from '../store/model';
import { BudgetWindows } from './BudgetWindows';
import { authHeaders, withAuthToken } from './auth';
import { apiUrl } from '../../platform/api-base';

interface ComposerProps {
  onSend: (text: string, attachments?: UploadedAttachment[]) => void;
  projectId?: string | null;
  className?: string;
  disabled?: boolean;
}

/** Read a browser File as a base64 data URL (the upload endpoint accepts the
 *  `data:<mime>;base64,` form and strips the prefix server-side). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

/** File types the message-attachment picker accepts. Images/audio, plus every
 *  document type the system-files reader can extract host-side: PDF, plain
 *  text/Markdown/CSV, Office & OpenDocument (Word/PowerPoint/Excel + odt/odp/ods),
 *  and legacy Excel. Listed as both MIME types and extensions since browsers vary
 *  in which they match. The server accepts any type — this only shapes the picker. */
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
].join(',');

/**
 * Upper bound on what ONE line of the composer can measure, used to seed the self-calibrating
 * baseline in {@link Composer}.
 *
 * This was a fixed 28px threshold — "a hair over the 20px line box" — which is only true of the
 * web textarea. A `TextInput` reports `contentSize.height` in the platform's own terms: Android
 * adds the input's internal padding and, depending on the font, can report a single line at more
 * than 28 on its own. A fixed number therefore reads "already wrapped" for a box with one
 * character in it, and the composer re-laid itself out on the FIRST keystroke of every message.
 *
 * Nothing here has to know the real number. The shortest height the field can ever report is one
 * line, by definition, so the smallest measurement seen is the baseline — this constant only has
 * to be too big for no target and small enough to be a safe starting guess before the first
 * measurement arrives.
 */
const ONE_LINE_CEILING = 40;

export function Composer({ onSend, projectId, className, disabled }: ComposerProps) {
  const mode = useStore((s) => s.mode);
  const budgetBlocked = useStore((s) => s.budgetBlocked);
  const [text, setText] = React.useState('');
  const [attachments, setAttachments] = React.useState<UploadedAttachment[]>([]);
  const [attaching, setAttaching] = React.useState(false);
  const [attachError, setAttachError] = React.useState<string | null>(null);
  const [completions, setCompletions] = React.useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [filteredCompletions, setFilteredCompletions] = React.useState<string[]>([]);
  const [recording, setRecording] = React.useState(false);
  // Drives the one-line/stacked switch. Fed by `adjustHeight` on web and by `Prim.TextArea`'s
  // `onContentHeight` on native — see `stacked` below.
  const [contentHeight, setContentHeight] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const mediaRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLUListElement>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const recordChunksRef = React.useRef<Blob[]>([]);
  const recordStreamRef = React.useRef<MediaStream | null>(null);
  const isDisabled = disabled || mode === 'replay' || budgetBlocked;

  // Stop any live mic track if the composer unmounts mid-recording.
  React.useEffect(() => () => {
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  React.useEffect(() => {
    if (dropdownOpen && dropdownRef.current) {
      const activeEl = dropdownRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (activeEl) {
        // DOM-only; the ref holds an RN instance on native (see `adjustHeight`).
        activeEl.scrollIntoView?.({ block: 'nearest' });
      }
    }
  }, [dropdownOpen, selectedIndex]);

  React.useEffect(() => {
    if (!projectId) return;
    fetch(apiUrl(`/api/projects/${projectId}/completions`), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: { completions?: string[] }) => { if (d.completions) setCompletions(d.completions); })
      .catch(() => {});
  }, [projectId]);

  /**
   * Grow the textarea with its content. Web-only by construction: `el.style` is a DOM
   * `CSSStyleDeclaration`, and on native the ref holds a React Native `TextInput` instance that has
   * no `style` object to assign to — an unguarded write is "Cannot set property 'height' of
   * undefined" on the FIRST keystroke, which took the composer down as soon as anything was typed.
   *
   * Bailing is still right on native, but NOT because nothing is needed there: `multiline` alone
   * does not auto-grow an RN `TextInput`. That target measures itself through
   * `onContentSizeChange` inside `Prim.TextArea` (`elements/primitives/controls.native.tsx`), so
   * the behaviour is the same on both and neither is expressed here.
   */
  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el?.style) return;
    el.style.height = 'auto';
    // Read BEFORE clamping: `scrollHeight` is the height the content wants, which is what decides
    // whether this is still one line. Reading the clamped `style.height` back would cap the signal
    // at `maxHeight` and the layout would stop switching exactly when it matters most.
    const wanted = el.scrollHeight;
    el.style.height = Math.min(wanted, 180) + 'px';
    setContentHeight(wanted);
  };

  const handleSend = () => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || isDisabled || attaching || recording) return;
    onSend(t, attachments.length ? attachments : undefined);
    setText('');
    setAttachments([]);
    setAttachError(null);
    setDropdownOpen(false);
    // Back to the one-line arrangement — without this the box keeps the stacked layout of the
    // message that was just sent, with nothing in it.
    setContentHeight(0);
    if (textareaRef.current?.style) textareaRef.current.style.height = 'auto';
  };

  /** Upload one File to /api/uploads and stage it as a pending attachment. Audio
   *  is transcribed server-side; the returned ref carries the transcript. */
  const uploadFile = async (file: File): Promise<void> => {
    const dataUrl = await readAsDataUrl(file);
    const res = await fetch(apiUrl('/api/uploads'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data: dataUrl,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `upload failed (${res.status})`);
    }
    const ref = (await res.json()) as UploadedAttachment;
    setAttachments((prev) => [...prev, ref]);
  };

  /** Upload one or more picked files and stage them on the pending message. */
  const handleMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setAttaching(true);
    setAttachError(null);
    try {
      for (const file of files) await uploadFile(file);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttaching(false);
      if (mediaRef.current) mediaRef.current.value = '';
    }
  };

  /** Toggle mic recording. Stopping uploads the clip (transcribed server-side)
   *  and stages it like any audio attachment — the transcript rides to the model
   *  as text when the message is sent, so the user can "talk" to THING. */
  const toggleRecord = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (isDisabled || attaching) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAttachError('Voice recording is not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) recordChunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        setRecording(false);
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(recordChunksRef.current, { type });
        if (blob.size === 0) return;
        const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        setAttaching(true);
        setAttachError(null);
        try {
          await uploadFile(file);
        } catch (err) {
          setAttachError(err instanceof Error ? err.message : String(err));
        } finally {
          setAttaching(false);
        }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
      setAttachError(null);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Microphone permission denied');
    }
  };

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const applyCompletion = (completion: string) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const textBefore = text.slice(0, cursor);
    const match = textBefore.match(/(?:^|\s)(@[^\s]*)$/);
    if (match) {
      const prefixLength = match[1]!.length;
      const startIdx = cursor - prefixLength;
      const newText = text.slice(0, startIdx) + completion + ' ' + text.slice(cursor);
      setText(newText);
      setDropdownOpen(false);
      setTimeout(() => {
        const newCursor = startIdx + completion.length + 1;
        textareaRef.current?.setSelectionRange(newCursor, newCursor);
        textareaRef.current?.focus();
      }, 0);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    adjustHeight();

    const cursor = e.target.selectionStart;
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/(?:^|\s)(@[^\s]*)$/);
    
    if (match) {
      const prefix = match[1]!;
      const hits = completions.filter(c => c.startsWith(prefix));
      if (hits.length > 0) {
        setFilteredCompletions(hits);
        setSelectedIndex(0);
        setDropdownOpen(true);
      } else {
        setDropdownOpen(false);
      }
    } else {
      setDropdownOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (dropdownOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredCompletions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredCompletions.length) % filteredCompletions.length);
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyCompletion(filteredCompletions[selectedIndex]!);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDropdownOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (mode === 'replay') {
    return (
      <Prim.Box className={className} paddingHorizontal="$4" paddingVertical="$3" fontSize="$sm" color="$muted-foreground" textAlign="center" borderTopWidth={1} borderColor="$border">
        <Prim.Text>Replay mode — input disabled</Prim.Text>
      </Prim.Box>
    );
  }


  /**
   * One line: `[+] [text] [mic] [send]`. More than one: the text takes the FULL width and the
   * controls move to a row underneath it, pinned to the bottom of the box.
   *
   * Flex wrapping cannot express this — Yoga wraps on width, and the field's width never changes,
   * only its height — so the switch is driven by the measured content height. Both targets report
   * it: the web textarea through `scrollHeight` in {@link adjustHeight}, the native input through
   * `onContentSizeChange` inside `Prim.TextArea`.
   *
   * ## Why this LATCHES rather than tracking the measurement
   *
   * The two states change the field's WIDTH, and the measurement depends on that width. Read
   * naively the composer oscillates: wrapping stacks it, stacking hands the field the full width,
   * at which point the same text fits in one line again, which unstacks it, which narrows the
   * field, which wraps it. That is an infinite re-render.
   *
   * So growing past a line latches it on, and only an empty box turns it off. Emptying is the one
   * transition where the answer cannot depend on the width, so it is the one that cannot lie.
   *
   * ## Why the baseline is measured, and measured while EMPTY
   *
   * "More than one line" is a comparison against the height of one line, and that number differs
   * per target and per font — see {@link ONE_LINE_CEILING}. So it is learned rather than declared.
   *
   * It is learned only while the box is empty, because that is the one state where "this is one
   * line" is true by definition. Taking the smallest height ever seen instead looks equivalent and
   * is not: the first measurement of a freshly mounted field comes back at its `minHeight` clamp,
   * below what an empty box actually settles at, and a baseline that low made an EMPTY composer
   * read as wrapped — so after sending, the box kept the stacked arrangement forever, with nothing
   * in it. An empty box cannot lie about its own height.
   */
  const [stacked, setStacked] = React.useState(false);
  const oneLineRef = React.useRef(ONE_LINE_CEILING);

  // Declared FIRST so it runs first: a measurement arriving on an empty box must update the
  // baseline before the latch below compares against it, or the very measurement that defines one
  // line is judged against the previous guess.
  React.useEffect(() => {
    if (text) return;
    setStacked(false);
    if (contentHeight > 0) oneLineRef.current = contentHeight;
  }, [text, contentHeight]);

  React.useEffect(() => {
    if (contentHeight > oneLineRef.current * 1.5) setStacked(true);
  }, [contentHeight]);

  const plusButton = (
    /* A PLUS, not a paperclip. A clip means "a file is stapled to this", which undersells what the
       picker takes — a photo, a voice note, a spreadsheet — and reads as the narrowest of those on
       a surface where most attachments are not documents.

       A `$7` square, the same box as send. It was a bare 16px glyph with `padding: $1` pulled back
       out by `margin: -0.25rem`, which made the gap either side of it unlike every other gap in the
       row and its tap target smaller than the button beside it.

       `$7` is 28px — under the 44px minimum touch target on a phone, where this control is the
       only pointer this composer has (no hover to widen the effective hit area). Base (mobile-
       first) is `$11` = 44px; `$md` shrinks it back to the original `$7` once a mouse is likely. */
    <Prim.Text as="label"
      key="attach"
      {...(attaching || isDisabled ? { opacity: 0.5, pointerEvents: 'none' as const } : {})} transition="quick" animateOnly={["color", "background-color", "border-color"]} flexShrink={0} width="$11" height="$11" $md={{ width: "$7", height: "$7" }} borderRadius="$radius-lg" display="flex" alignItems="center" justifyContent="center" color="$muted-foreground" cursor="pointer" hoverStyle={{ color: "$foreground" }}
      title="Add an image, audio, or file to your message"
    >
      <Prim.Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Prim.Line x1="12" y1="5" x2="12" y2="19" /><Prim.Line x1="5" y1="12" x2="19" y2="12" /></Prim.Svg>
      <Prim.TextField ref={mediaRef} type="file" accept={ATTACH_ACCEPT} multiple display="none" data-testid="attach-input" onChange={(e) => void handleMedia(e)} />
    </Prim.Text>
  );

  const field = (
    <Prim.TextArea
      key="field"
      ref={textareaRef}
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      disabled={isDisabled}
      rows={1}
      placeholder={budgetBlocked ? 'Budget reached — try again after it resets' : 'Message THING…'}
      data-testid="message-input"
      // Web only: autofocus on a phone pops the on-screen keyboard the instant the surface
      // mounts, before the reader has decided to type anything, which is exactly the kind of
      // surprise a native app should not spring. A desktop tab gaining focus costs nothing.
      {...(isWeb ? { autoFocus: true } : {})}
      // Native only, and passed conditionally because the web `TextArea` is a Tamagui component
      // over a real `<textarea>` — an unknown prop would reach the DOM. Web has no need of it:
      // `adjustHeight` already measures there.
      {...(isWeb ? {} : { onContentHeight: setContentHeight })}
      // `padding: 0` is what actually makes the box short. An RN `TextInput` carries its own
      // platform padding — several dp top and bottom on Android — which stacked on the row's and
      // made the composer half again as tall as its tallest child needs. A web textarea has none,
      // so the same value is a no-op there rather than a second rule.
      padding={0}
      flexGrow={1} flexShrink={1} flexBasis="0%" backgroundColor="transparent" color="$foreground" placeholderTextColor="$muted-foreground" fontSize="$sm" resize="none" minHeight={24} maxHeight={180} lineHeight="$sm" focusStyle={{ outlineWidth: 0, outlineStyle: "none" }} disabledStyle={{ opacity: 0.5 }}
    />
  );

  const micButton = (
    /* Beside SEND rather than beside the plus: both are ways of committing a message — one typed,
       one spoken — where the plus adds something to the draft you are still writing. Grouping by
       what a control does to the draft also puts the two a thumb reaches for on the side it
       reaches from. */
    <Prim.Pressable
      key="mic"
      type="button"
      onClick={() => void toggleRecord()}
      disabled={(isDisabled || attaching) && !recording}
      className={recording ? 'animate-pulse' : undefined} {...(recording ? { color: '$destructive' } : { color: '$muted-foreground', hoverStyle: { color: '$foreground' } })} transition="quick" animateOnly={["color", "background-color", "border-color"]} flexShrink={0} width="$11" height="$11" $md={{ width: "$7", height: "$7" }} borderRadius="$radius-lg" display="flex" alignItems="center" justifyContent="center" disabledStyle={{ opacity: 0.5 }}
      title={recording ? 'Stop recording' : 'Record a voice message'}
      aria-label={recording ? 'Stop recording' : 'Record a voice message'}
      data-testid="mic-button"
    >
      {recording ? (
        <Prim.Svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><Prim.Rect x="6" y="6" width="12" height="12" rx="2" /></Prim.Svg>
      ) : (
        <Prim.Svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Prim.Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" /><Prim.Path d="M19 10v2a7 7 0 0 1-14 0v-2" /><Prim.Line x1="12" y1="19" x2="12" y2="23" /><Prim.Line x1="8" y1="23" x2="16" y2="23" /></Prim.Svg>
      )}
    </Prim.Pressable>
  );

  const sendButton = (
    <Prim.Pressable
      key="send"
      onClick={handleSend}
      disabled={isDisabled || attaching || (!text.trim() && attachments.length === 0)}
      transition="quick" flexShrink={0} width="$11" height="$11" $md={{ width: "$7", height: "$7" }} borderRadius="$radius-lg" backgroundColor="$primary" color="$primary-foreground" alignItems="center" justifyContent="center" disabledStyle={{ opacity: 0.4 }} hoverStyle={{ opacity: 0.9 }} display="flex"
      aria-label="Send message"
    >
      <Prim.Svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><Prim.Path d="m3 3 3 9-3 9 19-9Z"/></Prim.Svg>
    </Prim.Pressable>
  );

  return (
    <Prim.Box className={className} paddingHorizontal="$4" paddingBottom="$4" paddingTop="$2">
      {/* Staged attachments */}
      {(attachments.length > 0 || attaching || attachError || recording) && (
        <Prim.Row marginBottom="$2" flexWrap="wrap" gap="$2" alignItems="center">
          {attachments.map((a) => (
            <Prim.Text
              key={a.id}
              alignItems="center" gap="$1.5" maxWidth="220px" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$muted" paddingHorizontal="$2" paddingVertical="$1" fontSize="$xs" color="$foreground" display="inline-flex"
              title={a.filename ?? a.mediaType}
            >
              {a.kind === 'image' ? (
                <Prim.Image src={withAuthToken(a.url)} alt={a.filename ?? 'image'} height="$5" width="$5" borderRadius="$radius" objectFit="cover" />
              ) : (
                <Prim.Text color="$muted-foreground">{a.kind === 'audio' ? '♪' : '📎'}</Prim.Text>
              )}
              <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{a.kind === 'audio' && a.transcript ? a.transcript : (a.filename ?? a.kind)}</Prim.Text>
              <Prim.Pressable
                onClick={() => removeAttachment(a.id)}
                flexShrink={0} color="$muted-foreground" hoverStyle={{ color: "$foreground" }}
                aria-label="Remove attachment"
              >
                ×
              </Prim.Pressable>
            </Prim.Text>
          ))}
          {recording && (
            <Prim.Text alignItems="center" gap="$1.5" fontSize="$xs" color="$destructive" display="inline-flex">
              <Prim.Text className="animate-pulse" height="$2" width="$2" borderRadius="$radius-full" backgroundColor="$destructive" />
              Recording… tap ■ to stop
            </Prim.Text>
          )}
          {attaching && <Prim.Text fontSize="$xs" color="$muted-foreground">Transcribing…</Prim.Text>}
          {attachError && <Prim.Text fontSize="$xs" color="$destructive">{attachError}</Prim.Text>}
        </Prim.Row>
      )}

      <Prim.Box
        transition="quick" animateOnly={["box-shadow"]} position="relative" backgroundColor="$card" borderWidth={1} borderColor="$border" borderRadius="$radius-xl" paddingHorizontal="$3" paddingVertical="$2" shadowColor="rgba(0,0,0,0.05)" shadowOffset={{ width: 0, height: 1 }} shadowRadius={2} focusWithinStyle={{ outlineWidth: 2, outlineStyle: "solid", outlineColor: "$ring" }}
        display="flex"
        flexDirection="column"
        gap="$2"
      >
        {/* Dropdown */}
        {dropdownOpen && (
          <Prim.List ref={dropdownRef} position="absolute" bottom="100%" left="$4" maxHeight="$60" overflow="auto" backgroundColor="$popover" color="$popover-foreground" borderWidth={1} borderColor="$border" borderRadius="$radius-md" shadowColor="rgba(0,0,0,0.1)" shadowOffset={{ width: 0, height: 10 }} shadowRadius={15} zIndex={50} minWidth="200px" fontSize="$sm" paddingVertical="$1" marginBottom="0.5rem">
            {filteredCompletions.map((c, i) => (
              <Prim.ListItem
                key={c}
                {...(i === selectedIndex
                  ? { backgroundColor: '$accent', color: '$accent-foreground' }
                  : { hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' } })}
                paddingHorizontal="$3" paddingVertical="$1.5" cursor="pointer"
                // `onMouseDown` used to be the ONLY pointer path to SELECT a completion — mouse
                // only, so on touch this dropdown was reachable by keyboard alone. `onClick` is
                // the same cross-platform primitive every other control in this file already uses
                // (`plusButton`/`micButton`/`sendButton` above), and `nativeSafeProps` maps it to
                // `onPress` on native — a tap now selects. `onMouseEnter` stays: it only syncs the
                // keyboard-arrow highlight to the mouse position, a desktop-only nicety with no
                // touch equivalent (there is no hover to sync to), and is harmless there since
                // `onClick` no longer depends on it to select the right item.
                onClick={() => applyCompletion(c)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {c}
              </Prim.ListItem>
            ))}
          </Prim.List>
        )}

        {/*
          ONE tree for both arrangements, and the reason is not tidiness.

          These used to be two branches — `<>{field}<Row>…</Row></>` against `<Row>…{field}…</Row>`
          — which put the field under a different PARENT in each. React reconciles by position, and
          a `key` only disambiguates siblings, so a parent change is a remount however it is
          keyed: the native `TextInput` was destroyed and rebuilt the instant the message wrapped,
          which DISMISSED THE KEYBOARD and threw focus away mid-sentence.

          So the field never moves. It stays this Row's second child in both states; the buttons
          beside it render as `null`, which holds their slots (static JSX children are a
          fixed-length array — a `null` keeps its index) and so keeps the field's index stable too.
          The stacked row below is a sibling that appears and disappears, which is safe: it owns no
          focus.
        */}
        <Prim.Row alignItems="center" gap="$2">
          {stacked ? null : plusButton}
          {field}
          {stacked ? null : micButton}
          {stacked ? null : sendButton}
        </Prim.Row>
        {stacked ? (
          <Prim.Row alignItems="center" gap="$2">
            {plusButton}
            {/* Pushes the mic and send to the far edge, so the two sides keep the positions they
                hold in the one-line arrangement instead of bunching up on the left. */}
            <Prim.Box flexGrow={1} flexShrink={1} />
            {micButton}
            {sendButton}
          </Prim.Row>
        ) : null}
      </Prim.Box>
      <BudgetWindows />
    </Prim.Box>
  );
}
