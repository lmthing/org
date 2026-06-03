import React, { useState } from 'react';
import { Text, Box, render } from 'ink';
import TextInput from 'ink-text-input';
import type { RenderHost } from '@repl/core';

interface JSXDescriptor {
  type: string | ((...args: unknown[]) => unknown);
  props: Record<string, unknown>;
  children: unknown[];
}

function isDescriptor(v: unknown): v is JSXDescriptor {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    'props' in v &&
    'children' in v
  );
}

interface TextInputFormProps {
  label: string;
  onSubmit: (value: string) => void;
}

function TextInputForm({ label, onSubmit }: TextInputFormProps): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box>
        <Text color="cyan">&gt; </Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}

export function renderDescriptor(desc: unknown): React.ReactNode {
  if (desc === null || desc === undefined) return null;

  if (typeof desc === 'string') return <Text>{desc}</Text>;
  if (typeof desc === 'number') return <Text>{String(desc)}</Text>;

  if (!isDescriptor(desc)) {
    return <Text>{JSON.stringify(desc)}</Text>;
  }

  const type = typeof desc.type === 'string' ? desc.type.toLowerCase() : '';
  const children = desc.children.map((child, i) => (
    <React.Fragment key={i}>{renderDescriptor(child)}</React.Fragment>
  ));

  const color = desc.props['color'] as string | undefined;
  const bold = desc.props['bold'] as boolean | undefined;

  switch (type) {
    case 'h1':
      return <Text bold color="cyan">{children}</Text>;
    case 'h2':
      return <Text bold color="blue">{children}</Text>;
    case 'h3':
      return <Text bold>{children}</Text>;
    case 'p':
      return <Box marginBottom={1}><Text>{children}</Text></Box>;
    case 'span':
      return <Text color={color} bold={bold}>{children}</Text>;
    case 'code': {
      const content =
        typeof desc.props['children'] === 'string'
          ? desc.props['children']
          : desc.children.map((c) => (typeof c === 'string' ? c : '')).join('');
      return <Text color="gray">{content}</Text>;
    }
    case 'card':
      return (
        <Box borderStyle="round" padding={1} flexDirection="column">
          {children}
        </Box>
      );
    case 'alert': {
      const variant = desc.props['variant'] as string | undefined;
      const alertColor = variant === 'error' ? 'red' : variant === 'warning' ? 'yellow' : 'green';
      return (
        <Box borderStyle="single" borderColor={alertColor} padding={1} flexDirection="column">
          {children}
        </Box>
      );
    }
    case 'badge': {
      const badgeColor = color ?? 'blue';
      return <Text color={badgeColor} bold>[{children}]</Text>;
    }
    case 'button': {
      const label = desc.props['label'] as string | undefined;
      return <Text color="cyan" bold>[{label ?? children}]</Text>;
    }
    case 'markdown':
    case 'text':
      return <Text>{children}</Text>;
    default:
      return <Box flexDirection="column">{children}</Box>;
  }
}

export class InkRenderHost implements RenderHost {
  // plain=true: use direct stdin reads (for automated/agent callers like Claude Code)
  // plain=false (default): use Ink TextInput (for human interactive use)
  constructor(private readonly plain = false) {}

  display(descriptor: unknown): void {
    const { unmount } = render(
      <Box flexDirection="column">{renderDescriptor(descriptor)}</Box>,
    );
    setTimeout(() => unmount(), 0);
  }

  ask(_id: string, descriptor: unknown): Promise<unknown> {
    const label = typeof descriptor === 'string'
      ? descriptor
      : isDescriptor(descriptor)
        ? typeof descriptor.props['label'] === 'string'
          ? descriptor.props['label']
          : String(descriptor.type)
        : 'Input';

    if (this.plain) {
      // Direct stdin reads: works in any PTY regardless of icrnl/raw-mode state.
      // Used when --claude flag is set so automated callers can pipe answers.
      process.stdout.write(`\n${label}\n> `);
      return new Promise((resolve) => {
        process.stdin.setEncoding('utf8');
        let buf = '';
        const onReadable = () => {
          let chunk: string | null;
          while ((chunk = process.stdin.read() as string | null) !== null) {
            buf += chunk;
            const rIdx = buf.indexOf('\r');
            const nIdx = buf.indexOf('\n');
            const idx = rIdx === -1 ? nIdx : nIdx === -1 ? rIdx : Math.min(rIdx, nIdx);
            if (idx !== -1) {
              process.stdin.off('readable', onReadable);
              resolve(buf.slice(0, idx).trim());
              return;
            }
          }
        };
        process.stdin.on('readable', onReadable);
      });
    }

    // Human mode: Ink TextInput with cursor, edit support, styled prompt.
    return new Promise((resolve) => {
      const { unmount } = render(
        <TextInputForm
          label={label}
          onSubmit={(value) => {
            unmount();
            resolve(value);
          }}
        />,
      );
    });
  }

  log(message: string): void {
    process.stdout.write(message + '\n');
  }
}
