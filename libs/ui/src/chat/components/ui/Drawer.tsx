import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  side?: 'right' | 'left';
  width?: string;
}

export function Drawer({ open, onClose, title, children, className, side = 'right', width = 'w-80' }: DrawerProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Prim.Row className="fixed inset-0 z-40">
      <Prim.Box className={cn('absolute inset-0 bg-foreground/10', side === 'left' ? 'right-0' : 'left-0')} onClick={onClose} />
      <Prim.Box
        display="flex"
        {...(side === 'right' ? { marginLeft: 'auto' } : { marginRight: 'auto' })}
        className={cn(
        'relative flex-col bg-card border-border shadow-lg h-full lm-slide-in-right',
        width,
        side === 'right' ? 'border-l' : 'border-r',
        className,
      )}>
        {title && (
          <Prim.Row className="justify-between px-4 py-3 border-b border-border" alignItems="center" flexShrink={0}>
            <Prim.Text className="font-semibold text-sm text-foreground">{title}</Prim.Text>
            <Prim.Pressable onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</Prim.Pressable>
          </Prim.Row>
        )}
        <Prim.Box className="flex-1 overflow-auto">{children}</Prim.Box>
      </Prim.Box>
    </Prim.Row>
  );
}
