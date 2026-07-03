import React from 'react';
import { cn } from '../../lib/cn.js';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Focus the first field ONLY when the dialog opens — not on every render.
  // Callers commonly pass `onClose` as a fresh arrow each render; keying this
  // effect on it would re-run on every keystroke and yank focus back to the
  // first focusable node (the × button), making inputs impossible to type in.
  React.useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const preferred = el.querySelector<HTMLElement>('input,textarea,select');
    const fallback = el.querySelector<HTMLElement>('button,[tabindex]:not([tabindex="-1"])');
    (preferred ?? fallback)?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className={cn('relative bg-card border border-border rounded-xl shadow-lg max-w-lg w-full max-h-[85vh] flex flex-col', className)}>
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <h2 className="font-semibold text-sm text-foreground">{title}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
          </div>
        )}
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
