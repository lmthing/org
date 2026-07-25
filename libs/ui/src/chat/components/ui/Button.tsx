import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'default' | 'ghost' | 'outline' | 'destructive' | 'brand';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /**
   * Flex-child placement, forwarded to the underlying `Prim.Pressable`. Declared because callers
   * used to reach for `className="self-end"` / `"shrink-0"` — Tailwind utilities with no future.
   */
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  flexShrink?: number;
}

/**
 * The `variants` / `sizes` class maps as `$`-token prop bags.
 *
 * `borderWidth: 0` is explicit on every non-`outline` variant. Under Tailwind it came from
 * PREFLIGHT (`*, ::before, ::after { border-width: 0 }`), so leaving it implicit would have made
 * these buttons depend on a reset that phase 4 removes — a UA button border appearing app-wide.
 */
const VARIANT: Record<ButtonVariant, Record<string, unknown>> = {
  default: { backgroundColor: '$primary', color: '$primary-foreground', borderWidth: 0, hoverStyle: { opacity: 0.9 } },
  ghost: { color: '$foreground', backgroundColor: 'transparent', borderWidth: 0, hoverStyle: { backgroundColor: '$accent' } },
  outline: { borderWidth: 1, borderColor: '$border', color: '$foreground', backgroundColor: 'transparent', hoverStyle: { backgroundColor: '$accent' } },
  destructive: { backgroundColor: '$destructive', color: '$destructive-foreground', borderWidth: 0, hoverStyle: { opacity: 0.9 } },
  brand: { backgroundColor: '$brand-2', color: '$primary', borderWidth: 0, hoverStyle: { opacity: 0.9 } },
};

/** `h-7 px-2.5 text-xs rounded-md` etc. on the `$space` / `$radius` scales. */
const SIZE: Record<ButtonSize, Record<string, unknown>> = {
  sm: { height: '$7', paddingHorizontal: '$2.5', fontSize: '$xs', borderRadius: '$radius-md' },
  md: { height: '$8', paddingHorizontal: '$3', fontSize: '$sm', borderRadius: '$radius-lg' },
  lg: { height: '$10', paddingHorizontal: '$4', fontSize: '$sm', borderRadius: '$radius-lg' },
  icon: { height: '$8', width: '$8', borderRadius: '$radius-lg', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};

export function Button({ variant = 'default', size = 'md', loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <Prim.Pressable
      {...props}
      disabled={disabled || loading}
      display="inline-flex"
      className={className} {...VARIANT[variant]} {...SIZE[size]} transition="quick" alignItems="center" justifyContent="center" gap="$1.5" fontWeight="$medium" userSelect="none" focusVisibleStyle={{ outlineWidth: 2, outlineStyle: "solid", outlineColor: "$ring" }} disabledStyle={{ opacity: 0.5, pointerEvents: "none" }}
    >
      {loading && <Prim.Text className="lm-spin" width="$3.5" height="$3.5" borderWidth={1} borderColor="$t-transparent" borderRadius="$radius-full" />}
      {children}
    </Prim.Pressable>
  );
}

export function IconButton({ className, title, 'aria-label': ariaLabel, ...props }: Omit<ButtonProps, 'size'> & { title?: string }) {
  return (
    <Button
      {...props}
      size="icon"
      variant={props.variant ?? 'ghost'}
      className={className}
      flexShrink={0}
      aria-label={ariaLabel ?? title}
      title={title}
    />
  );
}
