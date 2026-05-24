import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { SessionStatus, AgentAction, SpaceAgentInfo } from './types'

interface InputBarProps {
  onSend: (text: string) => void
  onPause: () => void
  onResume: () => void
  status: SessionStatus
  disabled: boolean
  actions?: AgentAction[]
  agents?: SpaceAgentInfo[]
  onSwitchAgent?: (slug: string) => void
}

const PLACEHOLDERS: Record<string, string> = {
  idle: 'Send a message...',
  executing: 'Send a message to the agent...',
  waiting_for_input: 'Or type a message instead...',
  paused: 'The agent is paused. Type your message...',
  complete: 'Send a follow-up...',
  error: 'Send a message to retry...',
}

export function InputBar({ onSend, onPause, onResume, status, disabled, actions = [], agents = [], onSwitchAgent }: InputBarProps) {
  const [text, setText] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [showAgents, setShowAgents] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const agentDropdownRef = useRef<HTMLDivElement>(null)

  const filteredActions = useMemo(() => {
    if (!showActions || actions.length === 0) return []
    const slashMatch = text.match(/^\/(\S*)$/)
    if (!slashMatch) return []
    const query = slashMatch[1].toLowerCase()
    return actions.filter(a => a.id.toLowerCase().startsWith(query))
  }, [text, showActions, actions])

  const filteredAgents = useMemo(() => {
    if (!showAgents || agents.length === 0) return []
    const atMatch = text.match(/^@(\S*)$/)
    if (!atMatch) return []
    const query = atMatch[1].toLowerCase()
    return agents.filter(a => a.slug.toLowerCase().startsWith(query))
  }, [text, showAgents, agents])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    setShowActions(false)
    setShowAgents(false)
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, onSend])

  const selectAction = useCallback((action: AgentAction) => {
    setText(`/${action.id} `)
    setShowActions(false)
    textareaRef.current?.focus()
  }, [])

  const selectAgent = useCallback((agent: SpaceAgentInfo) => {
    setText('')
    setShowAgents(false)
    onSwitchAgent?.(agent.slug)
    textareaRef.current?.focus()
  }, [onSwitchAgent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showAgents && filteredAgents.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedAgentIndex((i: number) => (i - 1 + filteredAgents.length) % filteredAgents.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedAgentIndex((i: number) => (i + 1) % filteredAgents.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectAgent(filteredAgents[selectedAgentIndex]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowAgents(false)
        return
      }
    }

    if (showActions && filteredActions.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i: number) => (i - 1 + filteredActions.length) % filteredActions.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i: number) => (i + 1) % filteredActions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectAction(filteredActions[selectedIndex]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowActions(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, showActions, filteredActions, selectedIndex, selectAction, showAgents, filteredAgents, selectedAgentIndex, selectAgent])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setText(value)

    if (actions.length > 0 && /^\/\S*$/.test(value)) {
      setShowActions(true)
      setSelectedIndex(0)
      setShowAgents(false)
    } else if (agents.length > 0 && /^@\S*$/.test(value)) {
      setShowAgents(true)
      setSelectedAgentIndex(0)
      setShowActions(false)
    } else {
      setShowActions(false)
      setShowAgents(false)
    }

    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }, [actions.length, agents.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        if (status === 'executing') onPause()
        else if (status === 'paused') onResume()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [status, onPause, onResume])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current !== e.target
      ) {
        setShowActions(false)
      }
      if (
        agentDropdownRef.current &&
        !agentDropdownRef.current.contains(e.target as Node) &&
        textareaRef.current !== e.target
      ) {
        setShowAgents(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const showPause = status === 'executing'
  const showResume = status === 'paused'
  const placeholder = PLACEHOLDERS[status] ?? PLACEHOLDERS.idle

  return (
    <div className="twv-input-bar" style={{ position: 'relative' }}>
      {showAgents && filteredAgents.length > 0 && (
        <div
          ref={agentDropdownRef}
          className="twv-actions-dropdown"
        >
          {filteredAgents.map((agent, i) => (
            <div
              key={agent.slug}
              onClick={() => selectAgent(agent)}
              className={`twv-actions-dropdown__item ${i === selectedAgentIndex ? 'twv-actions-dropdown__item--selected' : ''}`}
              onMouseEnter={() => setSelectedAgentIndex(i)}
            >
              <span className="twv-actions-dropdown__id">@{agent.slug}</span>
              <span className="twv-actions-dropdown__label">{agent.title}</span>
            </div>
          ))}
        </div>
      )}
      {showActions && filteredActions.length > 0 && (
        <div
          ref={dropdownRef}
          className="twv-actions-dropdown"
        >
          {filteredActions.map((action, i) => (
            <div
              key={action.id}
              onClick={() => selectAction(action)}
              className={`twv-actions-dropdown__item ${i === selectedIndex ? 'twv-actions-dropdown__item--selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="twv-actions-dropdown__id">/{action.id}</span>
              <span className="twv-actions-dropdown__label">{action.label}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        aria-label="Message input"
      />
      {showPause && (
        <button className="twv-btn-pause" onClick={onPause} aria-label="Pause agent execution">
          Pause
        </button>
      )}
      {showResume && (
        <button className="twv-btn-pause" onClick={onResume} aria-label="Resume agent execution">
          Resume
        </button>
      )}
      <button
        className="twv-btn-send"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  )
}
