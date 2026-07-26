import { clsx, type ClassValue } from 'clsx'

/**
 * Join class names. Formerly `twMerge(clsx(...))` — `tailwind-merge` exists to resolve conflicts
 * between Tailwind UTILITIES (`p-2 p-4` → `p-4`), and there are none left: every call site passes an
 * `lm-*` animation class, a BEM name, or a caller's passthrough. It was shipping a conflict table for
 * a vocabulary the codebase no longer speaks.
 *
 * `libs/ui/scripts/lint-no-tailwind.mjs` keeps both the dependency and the utilities out.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
