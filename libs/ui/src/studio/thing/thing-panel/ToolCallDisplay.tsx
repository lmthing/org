/**
 * Renders an assistant message's text, expanding any embedded tool-event
 * markers into inline `.thing-tool-event` blocks.
 */
import * as Prim from '../../../elements/primitives/index';
import { splitToolEventContent } from './use-tool-events'

export function ToolCallDisplay({ content }: { content: string }) {
  const segments = splitToolEventContent(content)
  return (
    <Prim.Text whiteSpace="pre-wrap" style={{ wordBreak: 'break-word' }}>
      {segments.map(segment => {
        if (segment.kind === 'text') return <Prim.Text key={segment.key}>{segment.text}</Prim.Text>
        return (
          <Prim.Text key={segment.key}>
            <Prim.Box
              marginVertical="$2"
              padding="$2"
              borderRadius="$radius-md"
              fontSize="$xs"
              fontFamily="monospace"
              backgroundColor="$muted"
              borderWidth={1}
              borderColor="$border"
              opacity={0.8}
            >
              <Prim.Text>{segment.toolContent}</Prim.Text>
            </Prim.Box>
            {segment.rest}
          </Prim.Text>
        )
      })}
    </Prim.Text>
  )
}
