/**
 * Renders an assistant message's text, expanding any embedded tool-event
 * markers into inline `.thing-tool-event` blocks.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { splitToolEventContent } from './use-tool-events'

export function ToolCallDisplay({ content }: { content: string }) {
  const segments = splitToolEventContent(content)
  return (
    <Prim.Box className="thing-msg__text">
      {segments.map(segment => {
        if (segment.kind === 'text') return <Prim.Text key={segment.key}>{segment.text}</Prim.Text>
        return (
          <Prim.Text key={segment.key}>
            <Prim.Box className="thing-tool-event">
              {segment.toolContent}
            </Prim.Box>
            {segment.rest}
          </Prim.Text>
        )
      })}
    </Prim.Box>
  )
}
