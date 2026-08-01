import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { cn } from '../../lib/cn';
import { onDismiss } from '../../../platform/keyboard';
import { isWeb } from '@tamagui/core';

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
    // DOM-only: autofocus here means "find the first field and focus it", which is a document
    // query. React Native has no querySelector and no focus order — a native dialog gets focus from
    // `autoFocus` on the input itself. Guarded rather than seamed because there is no native
    // behaviour to implement, only an absence.
    const el = ref.current;
    if (!el || !isWeb) return;
    const preferred = el.querySelector<HTMLElement>('input,textarea,select');
    const fallback = el.querySelector<HTMLElement>('button,[tabindex]:not([tabindex="-1"])');
    (preferred ?? fallback)?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // Escape on web; the Android back gesture on native — same one line, see platform/keyboard.
    return onDismiss(onClose);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Prim.Row position="fixed" top="$0" right="$0" bottom="$0" left="$0" zIndex={50} justifyContent="center" padding="$4" alignItems="center" role="dialog" aria-modal="true">
      {/* `backdrop-filter` has no Tamagui style prop, so this is a `style` — Tamagui merges it.
          Tailwind's `backdrop-blur-sm` resolved to `blur(var(--blur-sm))` and `--blur-sm` is 8px. */}
      <Prim.Box backdropFilter="blur(8px)" backgroundColor="color-mix(in srgb, var(--foreground) 20%, transparent)" position="absolute" top="$0" right="$0" bottom="$0" left="$0" onClick={onClose} />
      <Prim.Box ref={ref} display="flex" className={className} position="relative" backgroundColor="$card" borderWidth={1} borderColor="$border" borderRadius="$radius-xl" shadowColor="rgba(0,0,0,0.1)" shadowOffset={{ width: 0, height: 10 }} shadowRadius={15} maxWidth={512} width="100%" maxHeight="85vh" flexDirection="column">
        {title && (
          <Prim.Row justifyContent="space-between" paddingHorizontal="$4" paddingVertical="$3" borderBottomWidth={1} borderColor="$border" alignItems="center" flexShrink={0}>
            <Prim.Text as="h2" fontWeight="$semibold" fontSize="$sm" color="$foreground">{title}</Prim.Text>
            {/* `Pressable` is an RN `View` — its `color`/`fontSize` never reach the nested `Text`,
                which renders the × glyph at body size/ink without its own copy. */}
            <Prim.Pressable onClick={onClose} color="$muted-foreground" fontSize="$lg" lineHeight={18} hoverStyle={{ color: "$foreground" }}><Prim.Text color="$muted-foreground" fontSize="$lg">&times;</Prim.Text></Prim.Pressable>
          </Prim.Row>
        )}
        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto" padding="$4">{children}</Prim.Box>
      </Prim.Box>
    </Prim.Row>
  );
}
