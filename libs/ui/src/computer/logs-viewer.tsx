import * as Prim from '../elements/primitives/index.js';
import { useRef, useEffect, useState } from 'react'
import { Panel, PanelHeader } from '../elements/content/panel'
import { Button } from '../elements/forms/button'
import { Heading } from '../elements/typography/heading'

export interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

// `.computer-logs-viewer__message` `--warn`/`--error` modifiers driven by entry.level.
const MESSAGE_COLOR: Partial<Record<LogEntry['level'], string>> = {
  warn: '$warning',
  error: '$destructive',
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
      <Prim.Box display="flex" flexDirection="column" height="100%">
        <Prim.Box
          display="flex"
          alignItems="center"
          gap="$2"
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderBottomWidth={1}
          borderBottomColor="$border"
        >
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
        <Prim.Box
          ref={listRef}
          flexGrow={1}
          flexShrink={1}
          flexBasis="0%"
          overflow="auto"
          fontFamily="monospace"
          fontSize="$xs"
          padding="$3"
        >
          {filtered.length === 0 ? (
            <Prim.Text fontSize="$sm" color="$muted-foreground" paddingVertical="$4" textAlign="center">No logs</Prim.Text>
          ) : (
            filtered.map((entry, i) => (
              <Prim.Box key={i} display="flex" gap="$2">
                <Prim.Text color="$muted-foreground" flexShrink={0}>{formatTime(entry.timestamp)}</Prim.Text>
                <Prim.Text color="$primary" flexShrink={0}>[{entry.source}]</Prim.Text>
                <Prim.Text wordBreak="break-all" color={MESSAGE_COLOR[entry.level]}>
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
