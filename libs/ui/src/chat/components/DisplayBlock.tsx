import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { marked } from 'marked';
// `.lm-prose` lives in the shared markdown stylesheet; state the dependency where it is used so
// the class cannot go missing from a route that renders a `markdown` block.
import '@lmthing/css/components/markdown/index.css';

interface JSXDescriptor {
  type: string;
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

function renderNode(node: unknown, key?: number): React.ReactNode {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);

  if (!isDescriptor(node)) {
    return <Prim.Text key={key}>{JSON.stringify(node)}</Prim.Text>;
  }

  const { type, props, children } = node;
  const renderedChildren = children.map((child, i) => renderNode(child, i));

  switch (type.toLowerCase()) {
    case 'h1':
      return <Prim.Text as="h1" key={key} {...omitChildren(props)}>{renderedChildren}</Prim.Text>;
    case 'h2':
      return <Prim.Text as="h2" key={key} {...omitChildren(props)}>{renderedChildren}</Prim.Text>;
    case 'h3':
      return <Prim.Text as="h3" key={key} {...omitChildren(props)}>{renderedChildren}</Prim.Text>;
    case 'p':
      return <Prim.Text as="p" key={key} {...omitChildren(props)}>{renderedChildren}</Prim.Text>;
    case 'span':
      return <Prim.Text key={key} {...omitChildren(props)}>{renderedChildren}</Prim.Text>;
    case 'code':
      return <Prim.Text as="code" key={key} {...omitChildren(props)}>{renderedChildren}</Prim.Text>;
    case 'card':
      return (
        <Prim.Box key={key} borderWidth="1px" borderStyle="solid" borderColor="var(--border)" borderRadius={4} padding={12} {...omitChildren(props)}>
          {renderedChildren}
        </Prim.Box>
      );
    case 'alert': {
      const variant = props['variant'] as string | undefined;
      const color =
        variant === 'error'
          ? 'color-mix(in srgb, var(--destructive) 15%, transparent)'
          : variant === 'warning'
            ? 'color-mix(in srgb, var(--warning) 15%, transparent)'
            : 'color-mix(in srgb, var(--success) 15%, transparent)';
      return (
        <Prim.Box key={key} backgroundColor={color} padding={12} borderRadius={4} {...omitChildren(props)}>
          {renderedChildren}
        </Prim.Box>
      );
    }
    case 'badge': {
      const color = props['color'] as string | undefined;
      return (
        <Prim.Text
          key={key}
          backgroundColor={color ?? 'var(--agent)'} color="var(--agent-foreground)" paddingVertical="2px" paddingHorizontal="6px" borderRadius={4}
          {...omitChildren(props)}
        >
          {renderedChildren}
        </Prim.Text>
      );
    }
    case 'button':
      return (
        <Prim.Pressable key={key} {...omitChildren(props)}>
          {renderedChildren}
        </Prim.Pressable>
      );
    case 'markdown': {
      const text = props['text'] as string | undefined;
      const markdown = text || (renderedChildren.length > 0 ? renderedChildren.join('') : '');
      const html = marked.parse(String(markdown)) as string;
      // `.lm-prose` is the working class for `marked`-produced HTML — the same one `chat/app/Message`
      // uses. It replaces the `prose prose-sm` that was here, which needed @tailwindcss/typography:
      // never installed, so it styled nothing and this block rendered unformatted.
      return (
        <Prim.Box key={key} className="lm-prose" maxWidth="none" dangerouslySetInnerHTML={{ __html: html }} />
      );
    }
    case 'text':
    default:
      return <Prim.Text key={key}>{renderedChildren}</Prim.Text>;
  }
}

function omitChildren(props: Record<string, unknown>): Record<string, unknown> {
  const { children: _c, ...rest } = props;
  return rest as Record<string, unknown>;
}

interface DisplayBlockProps {
  descriptor: unknown;
}

export function DisplayBlock({ descriptor }: DisplayBlockProps): React.ReactElement {
  return <Prim.Box>{renderNode(descriptor)}</Prim.Box>;
}
