import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { cn } from '../../lib/cn';
import { onDismiss } from '../../../platform/keyboard';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  side?: 'right' | 'left';
  /**
   * Drawer width as a CSS length. This used to be a Tailwind CLASS (`'w-80'`) passed through to
   * `className` — a utility in the public API, which could not survive the Tailwind deletion.
   */
  width?: string;
}

export function Drawer({ open, onClose, title, children, className, side = 'right', width = '20rem' }: DrawerProps) {
  React.useEffect(() => {
    if (!open) return;
    // Escape on web; the Android back gesture on native — same one line, see platform/keyboard.
    return onDismiss(onClose);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Prim.Row position="fixed" top="$0" right="$0" bottom="$0" left="$0" zIndex={40}>
      {/* The backdrop already pins all four insets, so the old side-specific `right-0`/`left-0`
          was inert — dropped rather than translated. */}
      <Prim.Box backgroundColor="color-mix(in srgb, var(--foreground) 10%, transparent)" position="absolute" top="$0" right="$0" bottom="$0" left="$0" onClick={onClose} />
      <Prim.Box
        display="flex"
        {...(side === 'right' ? { marginLeft: 'auto' } : { marginRight: 'auto' })}
        {...(side === 'right' ? { borderLeftWidth: 1 } : { borderRightWidth: 1 })}
        className={cn("lm-slide-in-right", className)} width={width} position="relative" flexDirection="column" backgroundColor="$card" borderColor="$border" shadowColor="rgba(0,0,0,0.1)" shadowOffset={{ width: 0, height: 10 }} shadowRadius={15} height="100%">
        {title && (
          <Prim.Row justifyContent="space-between" paddingHorizontal="$4" paddingVertical="$3" borderBottomWidth={1} borderColor="$border" alignItems="center" flexShrink={0}>
            <Prim.Text fontWeight="$semibold" fontSize="$sm" color="$foreground">{title}</Prim.Text>
            <Prim.Pressable onClick={onClose} color="$muted-foreground" fontSize="$lg" lineHeight={18} hoverStyle={{ color: "$foreground" }}><Prim.Text>&times;</Prim.Text></Prim.Pressable>
          </Prim.Row>
        )}
        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto">{children}</Prim.Box>
      </Prim.Box>
    </Prim.Row>
  );
}
