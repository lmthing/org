import * as Prim from '../../../elements/primitives/index.js';
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
    <Prim.Row position="fixed" top="$0" right="$0" bottom="$0" left="$0" zIndex={50} justifyContent="center" padding="$4" alignItems="center" role="dialog" aria-modal="true">
      <Prim.Box className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <Prim.Box ref={ref} display="flex" className={cn('relative bg-card border border-border rounded-xl shadow-lg max-w-lg w-full max-h-[85vh] flex-col', className)}>
        {title && (
          <Prim.Row justifyContent="space-between" paddingHorizontal="$4" paddingVertical="$3" borderBottomWidth={1} borderColor="$border" alignItems="center" flexShrink={0}>
            <Prim.Text as="h2" fontWeight="$semibold" fontSize="$sm" color="$foreground">{title}</Prim.Text>
            <Prim.Pressable onClick={onClose} color="$muted-foreground" fontSize="$lg" lineHeight={1} hoverStyle={{ color: "$foreground" }}>&times;</Prim.Pressable>
          </Prim.Row>
        )}
        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto" padding="$4">{children}</Prim.Box>
      </Prim.Box>
    </Prim.Row>
  );
}
