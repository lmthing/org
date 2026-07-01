/**
 * Tool-event markers embedded in assistant message text: the streaming
 * handler wraps "running tool" / "tool result" notices in these markers so
 * `ToolCallDisplay` can pull them back out and render them as inline
 * tool-event blocks instead of plain text.
 */

export const TOOL_EVENT_OPEN = '[[THING_TOOL_EVENT]]'
export const TOOL_EVENT_CLOSE = '[[/THING_TOOL_EVENT]]'

export function toToolEventBlock(payload: string): string {
  return `${TOOL_EVENT_OPEN}\n${payload}\n${TOOL_EVENT_CLOSE}`
}

export type ToolEventSegment =
  | { kind: 'text'; key: number; text: string }
  | { kind: 'event'; key: number; toolContent: string; rest: string }

/**
 * Split raw assistant message content on the tool-event markers, yielding a
 * sequence of plain-text segments and tool-event segments in render order.
 */
export function splitToolEventContent(content: string): ToolEventSegment[] {
  const parts = content.split(TOOL_EVENT_OPEN)
  return parts.map((part, i) => {
    const closeIdx = part.indexOf(TOOL_EVENT_CLOSE)
    if (closeIdx === -1) return { kind: 'text', key: i, text: part }
    const toolContent = part.slice(0, closeIdx)
    const rest = part.slice(closeIdx + TOOL_EVENT_CLOSE.length)
    return { kind: 'event', key: i, toolContent, rest }
  })
}
