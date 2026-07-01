/**
 * The message composer: auto-growing textarea (Enter to send, Shift+Enter
 * for newline) plus the send button.
 */
import type { FormEvent } from 'react'

export interface ThingComposerProps {
  input: string
  setInput: (value: string) => void
  hasEnv: boolean
  isWorking: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function ThingComposer({ input, setInput, hasEnv, isWorking, onSubmit }: ThingComposerProps) {
  return (
    <form onSubmit={onSubmit} className="thing-panel__input-form">
      <textarea
        className="input thing-panel__textarea"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
        rows={2}
        placeholder={hasEnv ? 'Ask THING anything... (Enter to send, Shift+Enter for newline)' : 'Configure API keys to enable THING...'}
        disabled={!hasEnv}
      />
      <button
        type="submit"
        className="btn btn--primary"
        disabled={!hasEnv || isWorking || !input.trim()}
      >
        Send
      </button>
    </form>
  )
}
