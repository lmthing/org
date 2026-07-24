import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

export type ButtonVariant = 'default' | 'ghost' | 'outline' | 'destructive' | 'brand';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  ghost: 'text-foreground hover:bg-accent',
  outline: 'border border-border text-foreground hover:bg-accent',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  brand: 'bg-brand-2 text-primary hover:opacity-90',
};
const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-8 px-3 text-sm rounded-lg',
  lg: 'h-10 px-4 text-sm rounded-lg',
  icon: 'h-8 w-8 rounded-lg flex items-center justify-center',
};

export function Button({ variant = 'default', size = 'md', loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <Prim.Pressable
      {...props}
      disabled={disabled || loading}
      display="inline-flex"
      className={cn(
        'items-center justify-center gap-1.5 font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none select-none',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Prim.Text className="lm-spin w-3.5 h-3.5 border border-current border-t-transparent rounded-full" />}
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
      className={cn('shrink-0', className)}
      aria-label={ariaLabel ?? title}
      title={title}
    />
  );
}
