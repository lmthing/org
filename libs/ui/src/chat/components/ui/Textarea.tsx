import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { cn } from '../../lib/cn.js';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autosize?: boolean;
}

export function Textarea({ className, autosize, onChange, ...props }: TextareaProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (autosize && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px';
    }
    onChange?.(e);
  };

  React.useEffect(() => {
    if (autosize && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px';
    }
  }, [props.value, autosize]);

  return (
    <Prim.TextArea
      ref={ref}
      {...props}
      onChange={handleChange}
      className={cn(
        'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
    />
  );
}
