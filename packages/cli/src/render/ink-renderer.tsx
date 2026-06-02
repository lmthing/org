import React from 'react';
import { Text, Box, render } from 'ink';
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


function renderDescriptor(desc: unknown): React.ReactNode {
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
      return (
        <Text bold color="cyan">
          {children}
        </Text>
      );
    case 'h2':
      return (
        <Text bold color="blue">
          {children}
        </Text>
      );
    case 'h3':
      return (
        <Text bold>
          {children}
        </Text>
      );
    case 'p':
      return (
        <Box marginBottom={1}>
          <Text>{children}</Text>
        </Box>
      );
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
    default:
      return <Text>{children}</Text>;
  }
}

export class InkRenderHost implements RenderHost {
  display(descriptor: unknown): void {
    const { unmount } = render(
      <Box flexDirection="column">{renderDescriptor(descriptor)}</Box>,
    );
    // Render and immediately unmount static content (appended to stdout)
    // For streaming UI, a more sophisticated approach would be needed
    setTimeout(() => unmount(), 0);
  }

  ask(_id: string, descriptor: unknown): Promise<unknown> {
    // Use direct stdin I/O instead of Ink's TextInput to avoid raw-mode conflicts.
    // Ink's useInput requires setRawMode(true) which depends on icrnl being disabled;
    // this is unreliable across PTY environments. Direct stdin 'readable' works in
    // any cooked-mode terminal (handles both \r and \n as line end).
    const label = isDescriptor(descriptor)
      ? typeof descriptor.props['label'] === 'string'
        ? descriptor.props['label']
        : descriptor.type
      : 'Input';

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

  log(message: string): void {
    process.stdout.write(message + '\n');
  }
}
