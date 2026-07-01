/**
 * Renders an assistant message's text, expanding any embedded tool-event
 * markers into inline `.thing-tool-event` blocks.
 */
import { splitToolEventContent } from './use-tool-events'

export function ToolCallDisplay({ content }: { content: string }) {
  const segments = splitToolEventContent(content)
  return (
    <div className="thing-msg__text">
      {segments.map(segment => {
        if (segment.kind === 'text') return <span key={segment.key}>{segment.text}</span>
        return (
          <span key={segment.key}>
            <div className="thing-tool-event">
              {segment.toolContent}
            </div>
            {segment.rest}
          </span>
        )
      })}
    </div>
  )
}
