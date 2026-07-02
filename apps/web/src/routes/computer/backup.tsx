import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@lmthing/auth'
import { Card, CardHeader, CardBody } from '@lmthing/ui/elements/content/card'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@lmthing/ui/elements/overlays/dialog'
import { CLOUD_BASE_URL, COMPUTER_BASE_URL } from '@/lib/config'

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

interface BackupConfig {
  configured: boolean
  connected: boolean
  repo: string
  auto: boolean
  intervalMinutes: number
}

interface BackupStatus {
  status: 'ok' | 'error' | 'idle'
  lastBackupAt: string | null
  lastCommitSha: string | null
  error: string | null
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

/**
 * Workspace Backup settings: connect a GitHub App, choose a target repo, toggle
 * automatic periodic backup, and run manual backup / restore against the pod.
 */
export function Backup() {
  const { authFetch, isAuthenticated } = useAuth()
  const [cfg, setCfg] = useState<BackupConfig | null>(null)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [repo, setRepo] = useState('')
  const [auto, setAuto] = useState(false)
  const [interval, setIntervalMin] = useState(60)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshStatus = useCallback(() => {
    authFetch(`${COMPUTER_BASE_URL}/api/backup/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setStatus(d) })
      .catch(() => { /* pod may be asleep; ignore */ })
  }, [authFetch])

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    authFetch(`${CLOUD_BASE_URL}/api/backup/config`)
      .then((r) => r.json())
      .then((d: BackupConfig) => {
        if (cancelled) return
        setCfg(d)
        setRepo(d.repo ?? '')
        setAuto(d.auto ?? false)
        setIntervalMin(d.intervalMinutes ?? 60)
      })
      .catch(() => { if (!cancelled) setError('Failed to load backup settings') })
      .finally(() => { if (!cancelled) setLoading(false) })
    refreshStatus()
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, refreshStatus])

  const connect = async () => {
    setError(null)
    try {
      const res = await authFetch(
        `${CLOUD_BASE_URL}/api/backup/install-url?redirect_to=${encodeURIComponent(window.location.href)}`,
      )
      const d = await res.json()
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Failed to start GitHub connect')
      window.location.href = d.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect GitHub')
    }
  }

  const save = async () => {
    if (!REPO_RE.test(repo.trim())) { setError('Repo must be in "owner/name" form'); return }
    setSaving(true); setError(null); setNotice(null)
    try {
      const res = await authFetch(`${CLOUD_BASE_URL}/api/backup/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.trim(), auto, intervalMinutes: interval }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to save')
      setNotice('Saved. Pod is restarting to apply changes.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const backupNow = async () => {
    setBusy('backup'); setError(null); setNotice(null)
    try {
      const res = await authFetch(`${COMPUTER_BASE_URL}/api/backup`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Backup failed')
      setNotice(d.committed ? 'Backed up.' : 'Already up to date — nothing to back up.')
      refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    setBusy('restore'); setError(null); setNotice(null)
    try {
      const res = await authFetch(`${COMPUTER_BASE_URL}/api/restore`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.reason === 'no-backup' ? 'No backup found to restore' : (d.error ?? 'Restore failed'))
      setNotice(`Restored ${d.restored ?? 0} file(s) from ${d.branch}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <Heading level={4}>Workspace Backup</Heading>
      </CardHeader>
      <CardBody>
        <Caption muted>
          Back up your pod workspace to a GitHub repository you own. Secrets, sessions and
          conversations are never included.
        </Caption>

        {loading ? (
          <Caption muted>Loading…</Caption>
        ) : !cfg?.configured ? (
          <Caption muted>GitHub backup is not enabled on this server.</Caption>
        ) : !cfg.connected ? (
          <Button variant="primary" size="sm" onClick={connect}>Connect GitHub</Button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <Caption muted>Repository (owner/name)</Caption>
              <Input
                value={repo}
                placeholder="owner/repo"
                onChange={(e) => setRepo(e.target.value)}
                style={{ fontFamily: 'monospace' }}
              />
              <Caption muted>Create the (empty, private) repo on GitHub first.</Caption>
            </div>

            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <Caption>Automatic backup</Caption>
            </label>

            {auto && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Caption muted>Every</Caption>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={String(interval)}
                  onChange={(e) => setIntervalMin(Number(e.target.value) || 60)}
                  style={{ width: '6rem' }}
                />
                <Caption muted>minutes</Caption>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" size="sm" onClick={backupNow} disabled={busy !== null}>
                {busy === 'backup' ? 'Backing up…' : 'Back up now'}
              </Button>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={busy !== null}>Restore…</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Restore from GitHub?</DialogTitle>
                    <DialogDescription>
                      This overwrites workspace files with the latest backup. Local-only files,
                      your secrets and active sessions are kept. Continue?
                    </DialogDescription>
                  </DialogHeader>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <Button variant="primary" size="sm" onClick={restore} disabled={busy !== null}>
                      {busy === 'restore' ? 'Restoring…' : 'Restore'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Caption muted>
              Last backup: {relativeTime(status?.lastBackupAt ?? null)}
              {status?.lastCommitSha ? ` · ${status.lastCommitSha.slice(0, 7)}` : ''}
            </Caption>
            {status?.status === 'error' && status.error && (
              <Caption className="text-destructive">Last error: {status.error}</Caption>
            )}
          </div>
        )}

        {error && <Caption className="text-destructive">{error}</Caption>}
        {notice && <Caption muted>{notice}</Caption>}
      </CardBody>
    </Card>
  )
}
