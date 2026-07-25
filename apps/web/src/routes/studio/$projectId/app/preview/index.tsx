import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * Live preview of the built app, served at `/app/<project>/` on the same pod.
 *
 * SAFETY (spec §Safety / Phase 5B): the served pages carry a **strict CSP**
 * (no inline script; `connect-src` limited to the app's own api) and all
 * fetched third-party content is sanitized. Studio previews the app
 * **same-origin** (`lmthing.studio/app/<project>/…`), which is the one
 * same-origin XSS-sensitive spot — the CSP + sanitize are what keep a
 * self-XSS from reaching the admin `/api/*`. We do not sandbox the iframe away
 * from same-origin because the preview must be byte-identical to the CLI/prod
 * serving; the CSP is the control, not the iframe boundary.
 */
function AppPreview() {
  const { projectId } = useParams({ from: '/studio/$projectId/app' })
  const src = `${COMPUTER_BASE_URL}/app/${encodeURIComponent(projectId)}/`
  // Bump to force a reload of the iframe (cache-busting the src key remounts it).
  const [nonce, setNonce] = useState(0)

  return (
    <Prim.Box display="flex" flexDirection="column" height="100%" minHeight={0}>
      <Prim.Box
        display="flex" alignItems="center" gap="0.75rem" paddingVertical="0.5rem" paddingHorizontal="1.5rem" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--color-border)"
      >
        <Caption muted style={{ flex: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {src}
        </Caption>
        <Button variant="ghost" onClick={() => setNonce((n) => n + 1)} aria-label="Refresh preview">
          <RefreshCw style={{ width: 15, height: 15 }} /> Refresh
        </Button>
        <Button variant="ghost" onClick={() => window.open(src, '_blank', 'noopener')} aria-label="Open in new tab">
          <ExternalLink style={{ width: 15, height: 15 }} /> Open
        </Button>
      </Prim.Box>
      <Prim.IFrame
        key={nonce}
        title="App preview"
        src={src}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          background: 'var(--color-background)',
        }}
      />
    </Prim.Box>
  )
}

export const Route = createFileRoute('/studio/$projectId/app/preview/')({
  component: AppPreview,
})
