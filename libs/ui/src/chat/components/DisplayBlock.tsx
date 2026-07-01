import React from 'react';
import { marked } from 'marked';

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
    return <span key={key}>{JSON.stringify(node)}</span>;
  }

  const { type, props, children } = node;
  const renderedChildren = children.map((child, i) => renderNode(child, i));

  switch (type.toLowerCase()) {
    case 'h1':
      return <h1 key={key} {...omitChildren(props)}>{renderedChildren}</h1>;
    case 'h2':
      return <h2 key={key} {...omitChildren(props)}>{renderedChildren}</h2>;
    case 'h3':
      return <h3 key={key} {...omitChildren(props)}>{renderedChildren}</h3>;
    case 'p':
      return <p key={key} {...omitChildren(props)}>{renderedChildren}</p>;
    case 'span':
      return <span key={key} {...omitChildren(props)}>{renderedChildren}</span>;
    case 'code':
      return <code key={key} {...omitChildren(props)}>{renderedChildren}</code>;
    case 'card':
      return (
        <div key={key} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: 12 }} {...omitChildren(props)}>
          {renderedChildren}
        </div>
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
        <div key={key} style={{ backgroundColor: color, padding: 12, borderRadius: 4 }} {...omitChildren(props)}>
          {renderedChildren}
        </div>
      );
    }
    case 'badge': {
      const color = props['color'] as string | undefined;
      return (
        <span
          key={key}
          style={{ backgroundColor: color ?? 'var(--agent)', color: 'var(--agent-foreground)', padding: '2px 6px', borderRadius: 4 }}
          {...omitChildren(props)}
        >
          {renderedChildren}
        </span>
      );
    }
    case 'button':
      return (
        <button key={key} {...omitChildren(props)}>
          {renderedChildren}
        </button>
      );
    case 'markdown': {
      const text = props['text'] as string | undefined;
      const markdown = text || (renderedChildren.length > 0 ? renderedChildren.join('') : '');
      const html = marked.parse(String(markdown)) as string;
      return <div key={key} className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case 'text':
    default:
      return <span key={key}>{renderedChildren}</span>;
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
  return <div className="repl-display">{renderNode(descriptor)}</div>;
}
