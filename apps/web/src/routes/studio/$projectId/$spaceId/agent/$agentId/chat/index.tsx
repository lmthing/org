import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useAuth } from '@lmthing/auth'
import { useGlobRead } from '@lmthing/state'
import {
  useReplSession,
  ReplRpcClient,
  DisplayBlock,
  AskBlock,
  VariablesBlock,
} from '@lmthing/ui/chat'
import { COMPUTER_BASE_URL, CLOUD_BASE_URL } from '@/lib/config'

/** Ensure the user's compute pod is running before opening a session. */
async function ensurePod(
  cloudBaseUrl: string,
  getAccessToken: () => Promise<string>,
): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${cloudBaseUrl}/api/compute/ensure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/ensure failed: ${res.status}`)
  }
}

/** Files that belong to the editor but not the runnable space spec. */
function isRunnableSpaceFile(path: string): boolean {
  if (path.includes('/conversations/')) return false
  const base = path.split('/').pop() ?? ''
  if (base.startsWith('.env')) return false
  return true
}

type RunPhase = 'idle' | 'provisioning' | 'syncing' | 'starting' | 'ready'

function AgentChatPage() {
  const { agentId, spaceId } = Route.useParams()
  const { session, getAccessToken } = useAuth()

  // The current space's files, straight from the VFS in canonical on-disk
  // layout (agents/<slug>/instruct.md, tasklists/…, knowledge/…, functions/…).
  const spaceFiles = useGlobRead('**/*')
  const fileMap = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [path, content] of Object.entries(spaceFiles)) {
      if (isRunnableSpaceFile(path)) out[path] = content
    }
    return out
  }, [spaceFiles])

  // A pod-unique, single-segment name for this space (the sync endpoint rejects
  // path separators), stable for this space within the user's pod.
  const spaceName = useMemo(
    () => String(spaceId).replace(/[^a-zA-Z0-9._-]/g, '-'),
    [spaceId],
  )

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [podError, setPodError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const runningRef = useRef(false)
  const startedOnceRef = useRef(false)

  // Sync the current (possibly unsaved) space into the pod, then open a fresh
  // session against it. Re-runnable so edits can be pushed without a reload.
  const startSession = useCallback(async () => {
    if (!session?.accessToken || runningRef.current) return
    runningRef.current = true
    setPodError(null)
    setSessionId(null)
    try {
      setPhase('provisioning')
      await ensurePod(CLOUD_BASE_URL, getAccessToken)

      setPhase('syncing')
      const syncToken = await getAccessToken()
      const { spaceDir } = await ReplRpcClient.syncSpace(
        COMPUTER_BASE_URL,
        spaceName,
        fileMap,
        syncToken,
      )

      setPhase('starting')
      const createToken = await getAccessToken()
      const client = await ReplRpcClient.createSession(
        COMPUTER_BASE_URL,
        { spaceDir, agentSlug: agentId },
        createToken,
      )
      setSessionId(client.sessionId!)
      setPhase('ready')
    } catch (err) {
      setPodError(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    } finally {
      runningRef.current = false
    }
  }, [session, agentId, spaceName, fileMap, getAccessToken])

  // Auto-start once the VFS has hydrated. useGlobRead populates asynchronously,
  // so starting on bare mount would sync an EMPTY space (race). Wait until the
  // space actually has files before the first run.
  useEffect(() => {
    if (startedOnceRef.current || !session?.accessToken) return
    if (Object.keys(fileMap).length === 0) return
    startedOnceRef.current = true
    void startSession()
  }, [session, startSession, fileMap])

  const { blocks, sendMessage, submitForm, cancelAsk, isConnected, isDone } = useReplSession(
    sessionId
      ? { baseUrl: COMPUTER_BASE_URL, sessionId, accessToken: session?.accessToken }
      : // Pass a dummy config that won't connect until sessionId is set
        { baseUrl: COMPUTER_BASE_URL, sessionId: '', accessToken: session?.accessToken },
  )

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text || !isConnected) return
    sendMessage(text)
    setInputValue('')
  }, [inputValue, isConnected, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!session) {
    return <Prim.Box style={styles.center}>Signing in…</Prim.Box>
  }

  if (podError) {
    return (
      <Prim.Box style={styles.center}>
        <Prim.Text as="p" color="var(--destructive)">Failed to run space: {podError}</Prim.Text>
        <Prim.Pressable onClick={() => void startSession()}>Retry</Prim.Pressable>
      </Prim.Box>
    )
  }

  if (!sessionId) {
    return <Prim.Box style={styles.center}>{PHASE_LABEL[phase] ?? 'Starting agent session…'}</Prim.Box>
  }

  return (
    <Prim.Box style={styles.container}>
      {/* Connection status + re-sync control */}
      <Prim.Box style={styles.statusBar}>
        <Prim.Text color={isConnected ? 'var(--success)' : 'var(--destructive)'}>
          {isConnected ? '● Connected' : '○ Connecting…'}
        </Prim.Text>
        {isDone && <Prim.Text marginLeft={12} color="var(--muted-foreground)">Done</Prim.Text>}
        <Prim.Pressable
          onClick={() => void startSession()}
          disabled={runningRef.current || phase !== 'ready'}
          style={styles.resyncButton}
          title="Push the latest edits to your pod and restart the agent"
        >
          ↻ Re-sync &amp; restart
        </Prim.Pressable>
      </Prim.Box>

      {/* Block stream */}
      <Prim.Box style={styles.blocks}>
        {blocks.map((block) => {
          if (block.type === 'display') {
            return <DisplayBlock key={block.id} descriptor={block.data} />
          }
          if (block.type === 'ask') {
            return (
              <AskBlock
                key={block.id}
                id={block.id}
                descriptor={block.data}
                onSubmit={submitForm}
                onCancel={cancelAsk}
              />
            )
          }
          if (block.type === 'variables') {
            return <VariablesBlock key={block.id} vars={block.data as Record<string, unknown>} />
          }
          if (block.type === 'error') {
            return (
              <Prim.Box key={block.id} style={styles.errorBlock}>
                {String(block.data)}
              </Prim.Box>
            )
          }
          return null
        })}
      </Prim.Box>

      {/* Message input */}
      <Prim.Box style={styles.inputRow}>
        <Prim.TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message agent… (Enter to send, Shift+Enter for newline)"
          disabled={!isConnected}
          style={styles.textarea}
          rows={2}
        />
        <Prim.Pressable
          onClick={handleSend}
          disabled={!isConnected || !inputValue.trim()}
          style={styles.sendButton}
        >
          Send
        </Prim.Pressable>
      </Prim.Box>
    </Prim.Box>
  )
}

const PHASE_LABEL: Record<RunPhase, string> = {
  idle: 'Starting agent session…',
  provisioning: 'Provisioning compute pod…',
  syncing: 'Syncing space to your pod…',
  starting: 'Starting agent session…',
  ready: 'Ready',
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--muted-foreground)',
  } as React.CSSProperties,
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  resyncButton: {
    marginLeft: 'auto',
    padding: '2px 10px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
    fontSize: 12,
    cursor: 'pointer',
  } as React.CSSProperties,
  blocks: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  errorBlock: {
    background: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--destructive) 30%, transparent)',
    borderRadius: 4,
    padding: '8px 12px',
    color: 'var(--destructive)',
    fontFamily: 'monospace',
    fontSize: 13,
  } as React.CSSProperties,
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  } as React.CSSProperties,
  textarea: {
    flex: 1,
    resize: 'none' as const,
    padding: '8px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  sendButton: {
    padding: '0 16px',
    borderRadius: 4,
    border: 'none',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    fontWeight: 500,
    cursor: 'pointer',
    alignSelf: 'flex-end',
  } as React.CSSProperties,
}

export const Route = createFileRoute('/studio/$projectId/$spaceId/agent/$agentId/chat/')({
  component: AgentChatPage,
})
