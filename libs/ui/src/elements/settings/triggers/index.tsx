import * as Prim from '../../primitives/index';
import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { Badge } from '../../content/badge'
import { Button } from '../../forms/button'
import { Caption } from '../../typography/caption'
import { Code } from '../../typography/code'
import { dataPlaneOrigin } from '../../../lib/app-urls'
import { clipboard } from '../../../platform/clipboard'

interface Binding {
  path: string
  provider: string
  agentRef: string
  projectId: string
}

interface InboundInfo {
  baseUrl: string
  token: string
  bindings: Binding[]
}

/**
 * Triggers section content (no heading/card): inbound webhook URLs that fire
 * your agents. Mirrors Connections — same auth/fetch pattern, same tokens.
 * Each row shows the full public URL (`${baseUrl}/${path}`) with a copy
 * button; providers with signature verification need their signing secret
 * configured on the pod.
 */
export function Triggers() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')

  const [info, setInfo] = React.useState<InboundInfo | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    authFetch(`${CLOUD}/api/inbound`)
      .then((r) => r.json())
      .then((d: InboundInfo) => {
        if (cancelled) return
        setInfo({
          baseUrl: d.baseUrl ?? '',
          token: d.token ?? '',
          bindings: Array.isArray(d.bindings) ? d.bindings : [],
        })
      })
      .catch(() => { if (!cancelled) setError('Failed to load triggers') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, CLOUD])

  const copy = (path: string, url: string) => {
    void clipboard.writeText(url)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 2000)
  }

  return (
    <Prim.Box display="flex" flexDirection="column" gap="0.5rem">
      <Caption muted>
        These are inbound webhook URLs that trigger your agents. Point a service
        (Slack, GitHub, a cron provider, anything that can POST) at one of these
        URLs and the matching agent runs.
      </Caption>

      {loading ? (
        <Caption muted>Loading…</Caption>
      ) : !isAuthenticated ? (
        <Caption muted>Log in to manage triggers.</Caption>
      ) : !info || info.bindings.length === 0 ? (
        <Caption muted>
          No triggers yet — add a <Code>webhook</Code> hook or a space{' '}
          <Code>triggers:</Code> binding, then reload.
        </Caption>
      ) : (
        <Prim.Box display="flex" flexDirection="column" gap="0.5rem">
          {info.bindings.map((b) => {
            const url = `${info.baseUrl}/${b.path}`
            const isCopied = copiedPath === b.path
            return (
              <Prim.Box
                key={`${b.projectId}/${b.path}`}
                display="flex" flexDirection="column" gap="0.35rem" paddingVertical="0.5rem" paddingHorizontal="0" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--border)"
              >
                <Prim.Box display="flex" alignItems="center" gap="0.5rem">
                  <Caption>{b.path}</Caption>
                  <Badge variant="muted">{b.provider}</Badge>
                </Prim.Box>
                <Caption muted>{b.agentRef}</Caption>
                <Prim.Box display="flex" alignItems="center" gap="0.5rem">
                  <Code
                    flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto" whiteSpace="nowrap"
                  >
                    {url}
                  </Code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(b.path, url)}
                    flexShrink={0}
                  >
                    {isCopied ? 'Copied' : 'Copy'}
                  </Button>
                </Prim.Box>
              </Prim.Box>
            )
          })}
        </Prim.Box>
      )}

      <Caption muted>
        Providers with signature verification (Slack, GitHub) require their signing
        secret to be configured on the pod — env <Code>SLACK_SIGNING_SECRET</Code> /{' '}
        <Code>GITHUB_WEBHOOK_SECRET</Code> or <Code>LMTHING_WEBHOOK_SECRET_&lt;PATH&gt;</Code>.
      </Caption>

      {error && <Caption color="$destructive">{error}</Caption>}
    </Prim.Box>
  )
}
