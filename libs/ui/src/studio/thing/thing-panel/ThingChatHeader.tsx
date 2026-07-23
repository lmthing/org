import * as Prim from '../../../elements/primitives/index.js';
/**
 * Chat pane header: current conversation title plus a status dot reflecting
 * error / working / ready / needs-config state.
 */

export interface ThingChatHeaderProps {
  title: string
  isWorking: boolean
  hasError: boolean
  hasEnv: boolean
}

export function ThingChatHeader({ title, isWorking, hasError, hasEnv }: ThingChatHeaderProps) {
  const statusDotClass = `thing-panel__status-dot ${
    hasError ? 'thing-panel__status-dot--error'
    : isWorking ? 'thing-panel__status-dot--working'
    : hasEnv ? 'thing-panel__status-dot--ready'
    : 'thing-panel__status-dot--warn'
  }`

  return (
    <Prim.Box className="thing-panel__chat-header">
      <Prim.Text className="thing-panel__chat-title">
        {title}
      </Prim.Text>
      <Prim.Box className="thing-panel__chat-status">
        {isWorking && (
          <Prim.Text className="thing-panel__chat-status-text">Processing...</Prim.Text>
        )}
        <Prim.Text className={statusDotClass} />
      </Prim.Box>
    </Prim.Box>
  )
}
