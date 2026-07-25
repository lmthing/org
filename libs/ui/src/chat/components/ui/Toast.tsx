import * as Prim from '../../../elements/primitives/index';
import React from 'react';

export type ToastVariant = 'default' | 'success' | 'error';

interface ToastItem {
  id: string;
  message: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (msg: string, variant?: ToastVariant) => void;
}

/**
 * The former `vc` class map as prop bags. `border-knowledge/40` → a web `color-mix` at 40%, the
 * alpha treatment used throughout this codebase (Tamagui has no `/alpha` token syntax).
 * `lm-fade-in` stays a className — it is a KEYFRAME from `@lmthing/css/animations.css`, not Tailwind.
 */
const TOAST_VARIANT: Record<ToastVariant, Record<string, string>> = {
  default: { backgroundColor: '$card', borderColor: '$border', color: '$foreground' },
  success: { backgroundColor: '$card', borderColor: 'color-mix(in srgb, var(--knowledge) 40%, transparent)', color: '$foreground' },
  error: { backgroundColor: '$card', borderColor: 'color-mix(in srgb, var(--destructive) 40%, transparent)', color: '$foreground' },
};

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
            className="lm-fade-in" {...TOAST_VARIANT[t.variant ?? 'default']} paddingHorizontal="$4" paddingVertical="$3" borderRadius="$radius-xl" borderWidth={1} shadowColor="rgba(0,0,0,0.1)" shadowOffset={{ width: 0, height: 10 }} shadowRadius={15} fontSize="$sm" maxWidth={384}
          >
            {t.message}
          </Prim.Box>
        ))}
      </Prim.Col>
    </ToastCtx.Provider>
  );
}
