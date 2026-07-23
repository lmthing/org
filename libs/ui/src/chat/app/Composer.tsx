import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../lib/cn.js';
import { useStore } from '../store/store.js';
import type { UploadedAttachment } from '../store/model.js';
import { BudgetWindows } from './BudgetWindows.js';
import { authHeaders, withAuthToken } from './auth.js';

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
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [dropdownOpen, selectedIndex]);

  React.useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/completions`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: { completions?: string[] }) => { if (d.completions) setCompletions(d.completions); })
      .catch(() => {});
  }, [projectId]);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  };

  const handleSend = () => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || isDisabled || attaching || recording) return;
    onSend(t, attachments.length ? attachments : undefined);
    setText('');
    setAttachments([]);
    setAttachError(null);
    setDropdownOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  /** Upload one File to /api/uploads and stage it as a pending attachment. Audio
   *  is transcribed server-side; the returned ref carries the transcript. */
  const uploadFile = async (file: File): Promise<void> => {
    const dataUrl = await readAsDataUrl(file);
    const res = await fetch('/api/uploads', {
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
      <Prim.Box className={cn('px-4 py-3 text-sm text-muted-foreground text-center border-t border-border', className)}>
        Replay mode — input disabled
      </Prim.Box>
    );
  }

  return (
    <Prim.Box className={cn('px-4 pb-4 pt-2', className)}>
      {/* Staged attachments */}
      {(attachments.length > 0 || attaching || attachError || recording) && (
        <Prim.Box className="mb-2 flex flex-wrap items-center gap-2">
          {attachments.map((a) => (
            <Prim.Text
              key={a.id}
              className="inline-flex items-center gap-1.5 max-w-[220px] rounded-lg border border-border bg-muted px-2 py-1 text-xs text-foreground"
              title={a.filename ?? a.mediaType}
            >
              {a.kind === 'image' ? (
                <Prim.Image src={withAuthToken(a.url)} alt={a.filename ?? 'image'} className="h-5 w-5 rounded object-cover" />
              ) : (
                <Prim.Text className="text-muted-foreground">{a.kind === 'audio' ? '♪' : '📎'}</Prim.Text>
              )}
              <Prim.Text className="truncate">{a.kind === 'audio' && a.transcript ? a.transcript : (a.filename ?? a.kind)}</Prim.Text>
              <Prim.Pressable
                onClick={() => removeAttachment(a.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Remove attachment"
              >
                ×
              </Prim.Pressable>
            </Prim.Text>
          ))}
          {recording && (
            <Prim.Text className="inline-flex items-center gap-1.5 text-xs text-destructive">
              <Prim.Text className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
              Recording… tap ■ to stop
            </Prim.Text>
          )}
          {attaching && <Prim.Text className="text-xs text-muted-foreground">Transcribing…</Prim.Text>}
          {attachError && <Prim.Text className="text-xs text-destructive">{attachError}</Prim.Text>}
        </Prim.Box>
      )}

      <Prim.Box className="relative flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-ring transition-shadow">
        {/* Dropdown */}
        {dropdownOpen && (
          <Prim.List ref={dropdownRef} className="absolute bottom-full left-4 mb-2 max-h-60 overflow-auto bg-popover text-popover-foreground border border-border rounded-md shadow-lg z-50 min-w-[200px] text-sm py-1">
            {filteredCompletions.map((c, i) => (
              <Prim.ListItem
                key={c}
                className={cn(
                  "px-3 py-1.5 cursor-pointer",
                  i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyCompletion(c);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {c}
              </Prim.ListItem>
            ))}
          </Prim.List>
        )}

        {/* Attach image / audio / file to the message — the paperclip is the
            universal "attach to my message" affordance users reach for first. */}
        <Prim.Text as="label"
          className={cn(
            'shrink-0 mb-0.5 p-1 -m-1 text-muted-foreground hover:text-foreground cursor-pointer transition-colors',
            (attaching || isDisabled) && 'opacity-50 pointer-events-none',
          )}
          title="Attach image, audio, or file to your message"
        >
          <Prim.Svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Prim.Path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></Prim.Svg>
          <Prim.TextField ref={mediaRef} type="file" accept={ATTACH_ACCEPT} multiple className="hidden" data-testid="attach-input" onChange={(e) => void handleMedia(e)} />
        </Prim.Text>

        {/* Voice: record → transcribe → stage as an attachment (talk to THING) */}
        <Prim.Pressable
          type="button"
          onClick={() => void toggleRecord()}
          disabled={(isDisabled || attaching) && !recording}
          className={cn(
            'shrink-0 mb-0.5 transition-colors disabled:opacity-50',
            recording ? 'text-destructive animate-pulse' : 'text-muted-foreground hover:text-foreground',
          )}
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

        {/* Textarea */}
        <Prim.TextArea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          rows={1}
          placeholder={budgetBlocked ? 'Budget reached — try again after it resets' : 'Message THING…'}
          data-testid="message-input"
          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm resize-none focus:outline-none min-h-[24px] max-h-[180px] leading-6 disabled:opacity-50"
        />

        {/* Send */}
        <Prim.Pressable
          onClick={handleSend}
          disabled={isDisabled || attaching || (!text.trim() && attachments.length === 0)}
          className="shrink-0 mb-0.5 w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center transition-all disabled:opacity-40 hover:opacity-90"
          aria-label="Send message"
        >
          <Prim.Svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><Prim.Path d="m3 3 3 9-3 9 19-9Z"/></Prim.Svg>
        </Prim.Pressable>
      </Prim.Box>
      <Prim.Text as="p" className="mt-1.5 text-xs text-muted-foreground text-center">
        Enter to send · Shift+Enter for newline
      </Prim.Text>
      <BudgetWindows />
    </Prim.Box>
  );
}
