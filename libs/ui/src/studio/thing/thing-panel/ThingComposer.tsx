/**
 * The message composer: auto-growing textarea (Enter to send, Shift+Enter
 * for newline) plus the send button.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { Button } from '../../../elements/forms/button'
import type { FormEvent } from 'react'
import { INPUT_BASE } from '../../../elements/forms/input/index.js'

export interface ThingComposerProps {
  input: string
  setInput: (value: string) => void
  hasEnv: boolean
  isWorking: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function ThingComposer({ input, setInput, hasEnv, isWorking, onSubmit }: ThingComposerProps) {
  return (
    <Prim.Form onSubmit={onSubmit} className="thing-panel__input-form">
      <Prim.TextArea
        {...INPUT_BASE} className="thing-panel__textarea"
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
      <Button
        type="submit"
        variant="primary"
        disabled={!hasEnv || isWorking || !input.trim()}
      >
        Send
      </Button>
    </Prim.Form>
  )
}
