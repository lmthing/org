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
    <div className="fixed inset-0 z-40 flex">
      <div className={cn('absolute inset-0 bg-foreground/10', side === 'left' ? 'right-0' : 'left-0')} onClick={onClose} />
      <div className={cn(
        'relative flex flex-col bg-card border-border shadow-lg h-full lm-slide-in-right',
        width,
        side === 'right' ? 'ml-auto border-l' : 'mr-auto border-r',
        className,
      )}>
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="font-semibold text-sm text-foreground">{title}</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
          </div>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
