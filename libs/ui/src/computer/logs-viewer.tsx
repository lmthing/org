import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/logs-viewer.css'
import { useRef, useEffect, useState } from 'react'
import { Panel, PanelHeader } from '../elements/content/panel'
import { Button } from '../elements/forms/button'
import { Heading } from '../elements/typography/heading'
import { cn } from '../lib/utils'

export interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

export interface LogsViewerProps {
  logs: LogEntry[]
}

type LogFilter = 'all' | 'info' | 'warn' | 'error' | 'debug'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function LogsViewer({ logs }: LogsViewerProps) {
  const [filter, setFilter] = useState<LogFilter>('all')
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = filter === 'all' ? logs : logs.filter((l) => l.level === filter)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [filtered.length])

  return (
    <Panel>
      <PanelHeader>
        <Heading level={4}>Logs</Heading>
      </PanelHeader>
      <Prim.Box className="computer-logs-viewer">
        <Prim.Box className="computer-logs-viewer__toolbar">
          {(['all', 'info', 'warn', 'error', 'debug'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'primary' : 'ghost'}
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </Prim.Box>
        <Prim.Box ref={listRef} className="computer-logs-viewer__list">
          {filtered.length === 0 ? (
            <Prim.Box className="computer-logs-viewer__empty">No logs</Prim.Box>
          ) : (
            filtered.map((entry, i) => (
              <Prim.Box key={i} className="computer-logs-viewer__entry">
                <Prim.Text className="computer-logs-viewer__timestamp">{formatTime(entry.timestamp)}</Prim.Text>
                <Prim.Text className="computer-logs-viewer__source">[{entry.source}]</Prim.Text>
                <Prim.Text className={cn(
                  'computer-logs-viewer__message',
                  entry.level === 'warn' && 'computer-logs-viewer__message--warn',
                  entry.level === 'error' && 'computer-logs-viewer__message--error',
                )}>
                  {entry.message}
                </Prim.Text>
              </Prim.Box>
            ))
          )}
        </Prim.Box>
      </Prim.Box>
    </Panel>
  )
}

export { LogsViewer }
