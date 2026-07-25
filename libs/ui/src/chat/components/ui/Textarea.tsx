import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { cn } from '../../lib/cn';

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
      className={className} transition="quick" animateOnly={["color", "background-color", "border-color"]} width="100%" backgroundColor="$background" borderWidth={1} borderColor="$border" borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$2" fontSize="$sm" color="$foreground" placeholderTextColor="$muted-foreground" resize="none" focusVisibleStyle={{ outlineWidth: 2, outlineStyle: "solid", outlineColor: "$ring" }} disabledStyle={{ opacity: 0.5 }}
    />
  );
}
