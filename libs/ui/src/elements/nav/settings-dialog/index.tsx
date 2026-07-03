import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../overlays/dialog'
import { Button } from '../../forms/button'
import { Input } from '../../forms/input'
import { Heading } from '../../typography/heading'
import { Caption } from '../../typography/caption'
import { Avatar, AvatarFallback } from '../../content/avatar'
import { Separator } from '../../content/separator'
import { dataPlaneOrigin } from '../../../lib/app-urls'

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

/** Initials for the avatar fallback, derived from a name or email. */
function initials(label: string): string {
  const cleaned = label.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Workspace Backup settings section: connect a GitHub App, choose a target
 * repo, toggle automatic periodic backup, and run manual backup / restore.
 * Config lives on the gateway; backup/restore run on the compute pod.
 */
function WorkspaceBackup() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')
  const POD = dataPlaneOrigin('computer')

  const [cfg, setCfg] = React.useState<BackupConfig | null>(null)
  const [status, setStatus] = React.useState<BackupStatus | null>(null)
  const [repo, setRepo] = React.useState('')
  const [auto, setAuto] = React.useState(false)
  const [interval, setIntervalMin] = React.useState(60)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [busy, setBusy] = React.useState<null | 'backup' | 'restore'>(null)
  const [confirmRestore, setConfirmRestore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const refreshStatus = React.useCallback(() => {
    authFetch(`${POD}/api/backup/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setStatus(d) })
      .catch(() => { /* pod may be asleep; ignore */ })
  }, [authFetch, POD])

  React.useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    authFetch(`${CLOUD}/api/backup/config`)
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
  }, [authFetch, isAuthenticated, refreshStatus, CLOUD])

  const connect = async () => {
    setError(null)
    try {
      const res = await authFetch(
        `${CLOUD}/api/backup/install-url?redirect_to=${encodeURIComponent(window.location.href)}`,
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
      const res = await authFetch(`${CLOUD}/api/backup/config`, {
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
      const res = await authFetch(`${POD}/api/backup`, { method: 'POST' })
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
    setBusy('restore'); setError(null); setNotice(null); setConfirmRestore(false)
    try {
      const res = await authFetch(`${POD}/api/restore`, { method: 'POST' })
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Heading level={4}>Workspace Backup</Heading>
      <Caption muted>
        Back up your pod workspace to a GitHub repository you own. Secrets, sessions and
        conversations are never included.
      </Caption>

      {loading ? (
        <Caption muted>Loading…</Caption>
      ) : !isAuthenticated ? (
        <Caption muted>Log in to configure workspace backup.</Caption>
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
            <Button variant="outline" size="sm" onClick={backupNow} disabled={busy !== null}>
              {busy === 'backup' ? 'Backing up…' : 'Back up now'}
            </Button>
            {confirmRestore ? (
              <>
                <Button variant="primary" size="sm" onClick={restore} disabled={busy !== null}>
                  {busy === 'restore' ? 'Restoring…' : 'Confirm restore'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(false)} disabled={busy !== null}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(true)} disabled={busy !== null}>
                Restore…
              </Button>
            )}
          </div>

          {confirmRestore && (
            <Caption muted>
              Restore overwrites workspace files with the latest backup. Your secrets and active
              sessions are kept.
            </Caption>
          )}

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
    </section>
  )
}

export interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Shared account + workspace settings dialog, opened from the chat and studio
 * sidebar footers. Shows the logged-in user and hosts the GitHub workspace
 * backup controls. Presentation only depends on `@lmthing/auth`, so it works
 * identically on every surface.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { username, session, isAuthenticated, logout } = useAuth()
  const displayName = username ?? session?.email ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle asChild>
            <Heading level={2}>Settings</Heading>
          </DialogTitle>
          <DialogDescription asChild>
            <Caption muted>Your account and workspace preferences.</Caption>
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Heading level={4}>Account</Heading>
            {isAuthenticated && displayName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Avatar>
                  <AvatarFallback colorKey={session?.userId ?? displayName}>
                    {initials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Caption>{displayName}</Caption>
                  {session?.email && username && session.email !== username && (
                    <Caption muted>{session.email}</Caption>
                  )}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <Button variant="ghost" size="sm" onClick={logout}>
                    Log out
                  </Button>
                </div>
              </div>
            ) : (
              <Caption muted>Not logged in.</Caption>
            )}
          </section>

          <Separator />

          <WorkspaceBackup />
        </div>
      </DialogContent>
    </Dialog>
  )
}
