import React, { useState } from 'react';
import { Text, Box, render } from 'ink';
import TextInput from 'ink-text-input';
import type { RenderHost } from '@lmthing/core';
import { isFormDescriptor } from '@lmthing/core';
import { InkForm } from './ink-form.js';

function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s+/gm, '') // Remove headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // Bold
    .replace(/\*(.+?)\*/g, '$1') // Italic
    .replace(/\*(.+?)\*\*/g, '$1') // Bold italic
    .replace(/__(.+?)__/g, '$1') // Bold (alt)
    .replace(/_(.+?)_/g, '$1') // Italic (alt)
    .replace(/~~(.+?)~~/g, '$1') // Strikethrough
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Links
    .replace(/`(.+?)`/g, '$1') // Inline code
    .replace(/^- /gm, '• ') // Bullet points
    .replace(/^\* /gm, '• ') // Alt bullet points
    .replace(/^\d+\.\s/gm, '◦ ') // Ordered lists
    .trim();
}

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
    // ── headings + text ──
    case 'h1':
      return <Text bold color="cyan">{children}</Text>;
    case 'h2':
      return <Text bold color="blue">{children}</Text>;
    case 'h3':
      return <Text bold>{children}</Text>;
    case 'heading': {
      const level = (desc.props['level'] as number) ?? 1;
      return <Text bold color={level === 1 ? 'cyan' : level === 2 ? 'blue' : undefined}>{children}</Text>;
    }
    case 'p':
    case 'paragraph':
      return <Box marginBottom={1}><Text>{children}</Text></Box>;
    case 'span':
    case 'text':
      return <Text color={color} bold={bold} italic={desc.props['italic'] as boolean | undefined} dimColor={desc.props['dim'] as boolean | undefined}>{children}</Text>;
    case 'strong':
      return <Text bold>{children}</Text>;
    case 'em':
      return <Text italic>{children}</Text>;
    case 'muted':
      return <Text dimColor>{children}</Text>;
    case 'kbd':
      return <Text color="yellow">[{children}]</Text>;
    case 'quote':
      return <Box><Text dimColor>│ </Text><Text italic dimColor>{children}</Text></Box>;
    case 'link': {
      const href = desc.props['href'] as string | undefined;
      return <Text color="cyan" underline>{children}{href ? <Text dimColor> ({href})</Text> : null}</Text>;
    }
    case 'code': {
      const content =
        typeof desc.props['children'] === 'string'
          ? desc.props['children']
          : desc.children.map((c) => (typeof c === 'string' ? c : '')).join('');
      return <Text color="gray">{content}</Text>;
    }
    case 'codeblock':
      return <Box borderStyle="round" borderColor="gray" paddingX={1}><Text color="gray">{children}</Text></Box>;

    // ── layout ──
    case 'stack':
      return <Box flexDirection="column">{children}</Box>;
    case 'row':
    case 'inline': {
      const j = desc.props['justify'] as string | undefined;
      const jc = j === 'between' ? 'space-between' : j === 'center' ? 'center' : j === 'end' ? 'flex-end' : 'flex-start';
      return <Box flexDirection="row" gap={1} justifyContent={jc as 'flex-start'}>{children}</Box>;
    }
    case 'columns':
      return <Box flexDirection="row" gap={2}>{children}</Box>;
    case 'spacer':
      return <Box flexGrow={1} />;
    case 'divider': {
      const label = desc.props['label'] as string | undefined;
      return <Text dimColor>{'─'.repeat(8)}{label ? ` ${label} ` : ' '}{'─'.repeat(8)}</Text>;
    }

    // ── surfaces ──
    case 'card':
    case 'panel': {
      const title = desc.props['title'] as string | undefined;
      return (
        <Box borderStyle="round" padding={1} flexDirection="column">
          {title ? <Text bold>{title}</Text> : null}
          {children}
        </Box>
      );
    }
    case 'callout':
    case 'alert':
    case 'banner': {
      const variant = desc.props['variant'] as string | undefined;
      const alertColor = variant === 'error' ? 'red' : variant === 'warning' ? 'yellow' : variant === 'info' ? 'cyan' : 'green';
      const title = desc.props['title'] as string | undefined;
      return (
        <Box borderStyle="single" borderColor={alertColor} padding={1} flexDirection="column">
          {title ? <Text bold color={alertColor}>{title}</Text> : null}
          {children}
        </Box>
      );
    }
    case 'badge':
    case 'tag':
    case 'pill': {
      const badgeColor = color ?? 'blue';
      return <Text color={badgeColor} bold>[{children}]</Text>;
    }
    case 'button': {
      const label = desc.props['label'] as string | undefined;
      return <Text color="cyan" bold>[{label ?? children}]</Text>;
    }

    // ── collections ──
    case 'list':
    case 'orderedlist': {
      const ordered = type === 'orderedlist';
      const items = desc.props['items'] as (string | number)[] | undefined;
      if (items) {
        return (
          <Box flexDirection="column">
            {items.map((it, i) => (
              <Text key={i}>{ordered ? `${i + 1}. ` : '• '}{String(it)}</Text>
            ))}
          </Box>
        );
      }
      return <Box flexDirection="column">{children}</Box>;
    }
    case 'listitem':
      return <Box><Text>• </Text><Text>{children}</Text></Box>;
    case 'table': {
      const columns = (desc.props['columns'] as string[]) ?? [];
      const rows = (desc.props['rows'] as (string | number)[][]) ?? [];
      const widths = columns.map((c, i) =>
        Math.max(c.length, ...rows.map((r) => String(r[i] ?? '').length)),
      );
      const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
      return (
        <Box flexDirection="column">
          {columns.length > 0 && (
            <Text bold color="cyan">{columns.map((c, i) => pad(c, widths[i] ?? c.length)).join('  ')}</Text>
          )}
          {rows.map((r, ri) => (
            <Text key={ri}>{r.map((cell, ci) => pad(String(cell), widths[ci] ?? 0)).join('  ')}</Text>
          ))}
        </Box>
      );
    }
    case 'keyvalue': {
      const pairs = (desc.props['pairs'] as Record<string, unknown>) ?? {};
      const keys = Object.keys(pairs);
      const w = Math.max(0, ...keys.map((k) => k.length));
      return (
        <Box flexDirection="column">
          {keys.map((k) => (
            <Text key={k}><Text dimColor>{k.padEnd(w)}</Text>  {String(pairs[k])}</Text>
          ))}
        </Box>
      );
    }
    case 'timeline': {
      const items = (desc.props['items'] as { title: string; time?: string; detail?: string }[]) ?? [];
      return (
        <Box flexDirection="column">
          {items.map((it, i) => (
            <Box key={i} flexDirection="column">
              <Text>● {it.title}{it.time ? <Text dimColor> {it.time}</Text> : null}</Text>
              {it.detail ? <Text dimColor>  {it.detail}</Text> : null}
            </Box>
          ))}
        </Box>
      );
    }

    // ── indicators ──
    case 'progressbar': {
      const max = (desc.props['max'] as number) ?? (Number(desc.props['value']) <= 1 ? 1 : 100);
      const frac = Math.max(0, Math.min(1, Number(desc.props['value'] ?? 0) / max));
      const width = 20;
      const filled = Math.round(frac * width);
      const label = desc.props['label'] as string | undefined;
      return <Text>[{'█'.repeat(filled)}{'░'.repeat(width - filled)}] {Math.round(frac * 100)}%{label ? ` ${label}` : ''}</Text>;
    }
    case 'spinner':
      return <Text color="cyan">◐ {desc.props['label'] as string | undefined}</Text>;
    case 'statcard':
      return (
        <Box borderStyle="round" paddingX={1} flexDirection="column">
          <Text dimColor>{String(desc.props['label'] ?? '')}</Text>
          <Text bold>{String(desc.props['value'] ?? '')}</Text>
          {desc.props['delta'] ? <Text color="green">{String(desc.props['delta'])}</Text> : null}
        </Box>
      );
    case 'details':
      return (
        <Box flexDirection="column">
          <Text bold>▸ {String(desc.props['summary'] ?? 'Details')}</Text>
          <Box marginLeft={2} flexDirection="column">{children}</Box>
        </Box>
      );

    case 'markdown': {
      const text = desc.props['text'] as string | undefined;
      const markdown = text || (typeof desc.children[0] === 'string' ? desc.children[0] : '');
      const plainText = stripMarkdown(String(markdown));
      return <Box flexDirection="column" marginY={1}><Text>{plainText}</Text></Box>;
    }
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

    // Design-system / catalog form: render an interactive Ink form (human mode).
    if (!this.plain && isFormDescriptor(descriptor)) {
      return new Promise((resolve) => {
        const { unmount } = render(
          <InkForm
            descriptor={descriptor}
            onSubmit={(value) => {
              unmount();
              resolve(value);
            }}
          />,
        );
      });
    }

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
