import * as Prim from '../../primitives/index';
import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Input } from '../../forms/input'
import { Caption } from '../../typography/caption'
import { dataPlaneOrigin } from '../../../lib/app-urls'
import { currentUrl, openUrl } from '../../../platform/navigation'

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
 * Workspace backup section content (no heading/card): connect a GitHub App,
 * choose a target repo, toggle automatic periodic backup, and run manual backup
 * / restore. Config lives on the gateway; backup/restore run on the compute pod.
 */
export function WorkspaceBackup() {
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
        `${CLOUD}/api/backup/install-url?redirect_to=${encodeURIComponent(currentUrl())}`,
      )
      const d = await res.json()
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Failed to start GitHub connect')
      openUrl(d.url)
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
    <Prim.Box display="flex" flexDirection="column" gap="0.5rem">
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
        <Prim.Box display="flex" flexDirection="column" gap="0.5rem">
          <Caption muted>
            Connecting installs the backup App on your GitHub account. Next you'll point it at
            an empty private repo you own — nothing is pushed until you choose one and save.
          </Caption>
          <Button
            variant="primary"
            size="sm"
            onClick={connect}
            alignSelf="flex-start"
          >
            Connect GitHub
          </Button>
        </Prim.Box>
      ) : (
        <Prim.Box display="flex" flexDirection="column" gap="0.75rem">
          <Prim.Box display="flex" flexDirection="column" gap="0.35rem">
            <Caption>Point backups at an empty repo you own:</Caption>
            <Caption muted>
              1.{' '}
              <Prim.Link
                href="https://github.com/new?visibility=private"
                target="_blank"
                rel="noopener noreferrer"
                color="$primary" textDecorationLine="underline"
              >
                Create a new private repo ↗
              </Prim.Link>{' '}
              — leave it empty (no README, license or .gitignore).
            </Caption>
            <Caption muted>
              2. Give the backup App access to it —{' '}
              <Prim.Link
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noopener noreferrer"
                color="$primary" textDecorationLine="underline"
              >
                manage App access ↗
              </Prim.Link>{' '}
              (add the repo, or install on “All repositories”).
            </Caption>
            <Caption muted>3. Enter it below as owner/name and save.</Caption>
          </Prim.Box>

          <Prim.Box display="flex" flexDirection="column" gap="0.25rem">
            <Caption muted>Repository (owner/name)</Caption>
            <Input
              value={repo}
              placeholder="owner/repo"
              onChange={(e) => setRepo(e.target.value)}
              fontFamily="monospace"
            />
            <Caption muted>
              Must be empty — a repo that already has commits is rejected so a backup can never
              overwrite existing work.
            </Caption>
          </Prim.Box>

          <Prim.Text as="label" display="flex" gap="0.5rem" alignItems="center">
            <Prim.TextField type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <Caption>Automatic backup</Caption>
          </Prim.Text>

          {auto && (
            <Prim.Box display="flex" gap="0.5rem" alignItems="center">
              <Caption muted>Every</Caption>
              <Input
                type="number"
                min={5}
                max={1440}
                value={String(interval)}
                onChange={(e) => setIntervalMin(Number(e.target.value) || 60)}
                width="6rem"
              />
              <Caption muted>minutes</Caption>
            </Prim.Box>
          )}

          <Prim.Box display="flex" gap="0.5rem" flexWrap="wrap">
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
          </Prim.Box>

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
            <Caption color="$destructive">Last error: {status.error}</Caption>
          )}
        </Prim.Box>
      )}

      {error && <Caption color="$destructive">{error}</Caption>}
      {notice && <Caption muted>{notice}</Caption>}
    </Prim.Box>
  )
}
