import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { cn } from '../../lib/cn';

type BadgeVariant = 'default' | 'muted' | 'knowledge' | 'agent' | 'destructive' | 'brand';

/** Variant styling as `$`-token PROP BAGS — a table of class strings is still a className at the
 *  call site, so it blocked the codemod. Alpha uses the same web `color-mix` as the elements. */
const bv: Record<BadgeVariant, Record<string, string>> = {
  default: { backgroundColor: '$primary', color: '$primary-foreground' },
  muted: { backgroundColor: '$muted', color: '$muted-foreground' },
  knowledge: { backgroundColor: 'color-mix(in srgb, var(--knowledge) 15%, transparent)', color: '$knowledge' },
  agent: { backgroundColor: 'color-mix(in srgb, var(--agent) 15%, transparent)', color: '$agent' },
  destructive: { backgroundColor: 'color-mix(in srgb, var(--destructive) 15%, transparent)', color: '$destructive' },
  brand: { backgroundColor: 'color-mix(in srgb, var(--brand-2) 20%, transparent)', color: '$foreground' },
};

export function Badge({
  variant = 'muted',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <Prim.Text
      {...props}
      display="inline-flex"
      {...bv[variant]}
      className={className} alignItems="center" gap="$1" paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$radius-full" fontSize="$xs" fontWeight="$medium"
    >
      {children}
    </Prim.Text>
  );
}
