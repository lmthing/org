import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { Markdown } from '../../elements/content/markdown';
import { renderDescriptor, toRenderableDescriptor } from './render-descriptor';

/**
 * A `display()` block for the connected-session views — `ReplChatView` (the
 * Studio THING dock, project-app `<Chat>` pages) and the CLI's `--web` DevTools
 * app.
 *
 * It used to carry its OWN, much smaller descriptor switch: h1–h3, p, span,
 * code, card, alert, badge, button, markdown, and `<span>{children}</span>` for
 * everything else. That meant the components an agent actually reaches for —
 * `Stack`, `Table`, `KeyValue`, `List`, `Callout`, `StatCard` — rendered as
 * bare text with their props thrown away, and the prop-only ones (a `Table` has
 * no children, only `columns`/`rows`) rendered as **nothing at all**. Anything
 * that wasn't a descriptor was `JSON.stringify`d straight at the reader.
 *
 * There is one descriptor vocabulary, so there is one renderer: this delegates
 * to `renderDescriptor`, the same function `/chat`'s transcript uses. Two
 * renderers for one catalog is two behaviours for one agent answer.
 */
interface DisplayBlockProps {
  descriptor: unknown;
}

export function DisplayBlock({ descriptor }: DisplayBlockProps): React.ReactElement {
  // A string display is prose — markdown, the same as the chat transcript
  // treats it — UNLESS it is a descriptor that was serialized on the way here.
  if (typeof descriptor === 'string') {
    const parsed = toRenderableDescriptor(descriptor);
    return <Prim.Box>{parsed ? renderDescriptor(parsed) : <Markdown source={descriptor} preset="prose" />}</Prim.Box>;
  }
  return <Prim.Box>{renderDescriptor(descriptor)}</Prim.Box>;
}
