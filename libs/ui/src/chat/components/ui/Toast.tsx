import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export type ToastVariant = 'default' | 'success' | 'error';

interface ToastItem {
  id: string;
  message: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (msg: string, variant?: ToastVariant) => void;
}

const ToastCtx = React.createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return React.useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback((message: string, variant: ToastVariant = 'default') => {
    const id = Math.random().toString(36).slice(2);
    setItems(p => [...p, { id, message, variant }]);
    setTimeout(() => setItems(p => p.filter(t => t.id !== id)), 3000);
  }, []);

  const vc: Record<ToastVariant, string> = {
    default: 'bg-card border-border text-foreground',
    success: 'bg-card border-knowledge/40 text-foreground',
    error: 'bg-card border-destructive/40 text-foreground',
  };

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <Prim.Col
        position="fixed" bottom="$4" right="$4" zIndex={50} gap="$2" pointerEvents="none"
        aria-live="polite"
      >
        {items.map(t => (
          <Prim.Box
            key={t.id}
            className={cn(
              'px-4 py-3 rounded-xl border shadow-lg text-sm lm-fade-in max-w-sm',
              vc[t.variant ?? 'default'],
            )}
          >
            {t.message}
          </Prim.Box>
        ))}
      </Prim.Col>
    </ToastCtx.Provider>
  );
}
