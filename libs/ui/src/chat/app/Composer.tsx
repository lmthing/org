import React from 'react';
import { cn } from '../lib/cn.js';
import { useStore } from '../store/store.js';
import { BudgetWindows } from './BudgetWindows.js';

interface ComposerProps {
  onSend: (text: string) => void;
  projectId?: string | null;
  className?: string;
  disabled?: boolean;
}

export function Composer({ onSend, projectId, className, disabled }: ComposerProps) {
  const mode = useStore((s) => s.mode);
  const [text, setText] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [completions, setCompletions] = React.useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [filteredCompletions, setFilteredCompletions] = React.useState<string[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLUListElement>(null);
  const isDisabled = disabled || mode === 'replay';

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
    fetch(`/api/projects/${projectId}/completions`)
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
    if (!t || isDisabled) return;
    onSend(t);
    setText('');
    setDropdownOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

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

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    setUploading(true);
    try {
      const content = await file.text();
      await fetch(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, content }),
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (mode === 'replay') {
    return (
      <div className={cn('px-4 py-3 text-sm text-muted-foreground text-center border-t border-border', className)}>
        Replay mode — input disabled
      </div>
    );
  }

  return (
    <div className={cn('px-4 pb-4 pt-2', className)}>
      <div className="relative flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-ring transition-shadow">
        {/* Dropdown */}
        {dropdownOpen && (
          <ul ref={dropdownRef} className="absolute bottom-full left-4 mb-2 max-h-60 overflow-auto bg-popover text-popover-foreground border border-border rounded-md shadow-lg z-50 min-w-[200px] text-sm py-1">
            {filteredCompletions.map((c, i) => (
              <li
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
              </li>
            ))}
          </ul>
        )}

        {/* Attach */}
        {projectId && (
          <label className={cn('shrink-0 mb-0.5 text-muted-foreground hover:text-foreground cursor-pointer transition-colors', uploading && 'opacity-50 pointer-events-none')} title="Attach document">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => void handleFile(e)} />
          </label>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          rows={1}
          placeholder="Message THING…"
          data-testid="message-input"
          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm resize-none focus:outline-none min-h-[24px] max-h-[180px] leading-6 disabled:opacity-50"
        />

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={isDisabled || !text.trim()}
          className="shrink-0 mb-0.5 w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center transition-all disabled:opacity-40 hover:opacity-90"
          aria-label="Send message"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="m3 3 3 9-3 9 19-9Z"/></svg>
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground text-center">
        Enter to send · Shift+Enter for newline
      </p>
      <BudgetWindows />
    </div>
  );
}
