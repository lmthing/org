import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { teamApi } from '@/lib/team-api'
import { useTeamAuth } from '@/lib/team-auth'

/**
 * Team settings: the name, and the team's own credentials.
 *
 * The credentials are the team's, never a member's — this is where a team's
 * Slack/GitHub/Google tokens live, on the team's pod. Saving REPLACES the whole
 * set and rolls the pod for everyone, so the editor is a full-text view of it
 * and the warning says so plainly.
 */
function SettingsPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const { authFetch } = useAuth()
  const team = useTeamAuth()
  const isEditor = team.role === 'editor'

  const [name, setName] = useState('')
  const [envText, setEnvText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const detail = await teamApi.get(authFetch, teamId)
      setName(detail.name)
      if (detail.role === 'editor') {
        const { vars } = await teamApi.getEnv(authFetch, teamId)
        setEnvText(
          Object.entries(vars)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
        )
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [authFetch, teamId])

  useEffect(() => {
    void load()
  }, [load])

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await teamApi.rename(authFetch, teamId, trimmed)
      setNotice('Name saved.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveEnv = async () => {
    setBusy(true)
    try {
      const vars: Record<string, string> = {}
      for (const line of envText.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) throw new Error(`Not a KEY=VALUE line: ${trimmed}`)
        vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
      }
      await teamApi.setEnv(authFetch, teamId, vars)
      setNotice('Credentials saved — the team workspace is restarting.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Prim.Box padding="$6" maxWidth={720} overflow="auto" height="100%">
      <Prim.Text as="h1" fontSize="$xl" fontWeight="600" marginBottom="$4">
        Settings
      </Prim.Text>

      {error ? (
        <Prim.Text color="$destructive" fontSize="$sm" marginBottom="$3">
          {error}
        </Prim.Text>
      ) : null}
      {notice ? (
        <Prim.Text color="$muted-foreground" fontSize="$sm" marginBottom="$3">
          {notice}
        </Prim.Text>
      ) : null}

      <Prim.Box marginBottom="$6">
        <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$2">
          Name
        </Prim.Text>
        <Prim.Row gap="$2">
          <Prim.TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            flex={1}
            disabled={!isEditor}
          />
          {isEditor ? (
            <Prim.Pressable
              onClick={() => void saveName()}
              disabled={busy}
              paddingHorizontal="$3"
              paddingVertical="$2"
              borderRadius="$md"
              backgroundColor="$primary"
            >
              <Prim.Text color="$primary-foreground" fontSize="$sm">
                Save
              </Prim.Text>
            </Prim.Pressable>
          ) : null}
        </Prim.Row>
      </Prim.Box>

      {isEditor ? (
        <Prim.Box>
          <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$1">
            Credentials
          </Prim.Text>
          <Prim.Text as="p" fontSize="$xs" color="$muted-foreground" marginBottom="$2">
            The team's own provider tokens, one KEY=VALUE per line. These belong to
            the team, not to you. Saving replaces the whole set and restarts the
            team workspace for everyone.
          </Prim.Text>
          <Prim.TextArea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={12}
            width="100%"
          />
          <Prim.Pressable
            onClick={() => void saveEnv()}
            disabled={busy}
            marginTop="$2"
            paddingHorizontal="$3"
            paddingVertical="$2"
            borderRadius="$md"
            backgroundColor="$primary"
            alignSelf="flex-start"
          >
            <Prim.Text color="$primary-foreground" fontSize="$sm">
              Save credentials
            </Prim.Text>
          </Prim.Pressable>
        </Prim.Box>
      ) : (
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          Only an editor can see or change the team's credentials.
        </Prim.Text>
      )}
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/$teamId/settings')({
  component: SettingsPage,
})
