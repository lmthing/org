import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { teamApi, type TeamDetail, type TeamRole } from '@/lib/team-api'
import { useTeamAuth } from '@/lib/team-auth'

/**
 * The roster. Adding someone by email either seats them immediately (they have
 * an account) or records an invite they claim on next login — there is no
 * mailer, so the inviter shares the lmthing.team link themselves.
 *
 * Editing affordances are hidden from viewers, but the gateway enforces the
 * role regardless; this only avoids offering a button that would 403.
 */
function MembersPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const { authFetch, session } = useAuth()
  const team = useTeamAuth()
  const [detail, setDetail] = useState<TeamDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('viewer')
  const isEditor = team.role === 'editor'

  const load = useCallback(async () => {
    try {
      setDetail(await teamApi.get(authFetch, teamId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [authFetch, teamId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      setNotice(ok ?? null)
      setError(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const add = () => {
    const trimmed = email.trim()
    if (!trimmed) return
    void run(async () => {
      const result = await teamApi.addMember(authFetch, teamId, trimmed, role)
      setEmail('')
      setNotice(
        result.status === 'added'
          ? `${result.email} joined the team.`
          : `${result.email} has no account yet — they'll see the invitation when they sign in at lmthing.team.`,
      )
    })
  }

  return (
    <Prim.Box padding="$6" maxWidth={720} overflow="auto" height="100%">
      <Prim.Text as="h1" fontSize="$xl" fontWeight="600" marginBottom="$4">
        Members
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

      <Prim.Col gap="$2" marginBottom="$6">
        {(detail?.members ?? []).map((member) => (
          <Prim.Row
            key={member.user_id}
            alignItems="center"
            gap="$3"
            padding="$3"
            borderWidth={1}
            borderColor="$border"
            borderRadius="$md"
          >
            <Prim.Box flex={1} minWidth={0}>
              <Prim.Text fontSize="$sm">{member.email}</Prim.Text>
              {member.user_id === session?.userId ? (
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  you
                </Prim.Text>
              ) : null}
            </Prim.Box>
            {isEditor ? (
              <Prim.Select
                value={member.role}
                onChange={(e) =>
                  void run(() =>
                    teamApi.setRole(authFetch, teamId, member.user_id, e.target.value as TeamRole),
                  )
                }
              >
                <Prim.Option value="viewer">viewer</Prim.Option>
                <Prim.Option value="editor">editor</Prim.Option>
              </Prim.Select>
            ) : (
              <Prim.Text fontSize="$xs" color="$muted-foreground">
                {member.role}
              </Prim.Text>
            )}
            {isEditor || member.user_id === session?.userId ? (
              <Prim.Pressable
                onClick={() =>
                  void run(() => teamApi.removeMember(authFetch, teamId, member.user_id))
                }
              >
                <Prim.Text fontSize="$xs" color="$destructive">
                  {member.user_id === session?.userId ? 'Leave' : 'Remove'}
                </Prim.Text>
              </Prim.Pressable>
            ) : null}
          </Prim.Row>
        ))}
      </Prim.Col>

      {(detail?.invites.length ?? 0) > 0 ? (
        <Prim.Box marginBottom="$6">
          <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$2">
            Pending invitations
          </Prim.Text>
          <Prim.Col gap="$2">
            {(detail?.invites ?? []).map((invite) => (
              <Prim.Row
                key={invite.id}
                alignItems="center"
                gap="$3"
                padding="$2"
                borderWidth={1}
                borderColor="$border"
                borderRadius="$md"
              >
                <Prim.Text fontSize="$sm" flex={1}>
                  {invite.email}
                </Prim.Text>
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  {invite.role}
                </Prim.Text>
                {isEditor ? (
                  <Prim.Pressable
                    onClick={() =>
                      void run(() => teamApi.revokeInvite(authFetch, teamId, invite.id))
                    }
                  >
                    <Prim.Text fontSize="$xs" color="$destructive">
                      Revoke
                    </Prim.Text>
                  </Prim.Pressable>
                ) : null}
              </Prim.Row>
            ))}
          </Prim.Col>
        </Prim.Box>
      ) : null}

      {isEditor ? (
        <Prim.Box>
          <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$2">
            Add someone
          </Prim.Text>
          <Prim.Row gap="$2" alignItems="center">
            <Prim.TextField
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their@email.com"
              flex={1}
            />
            <Prim.Select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              <Prim.Option value="viewer">viewer</Prim.Option>
              <Prim.Option value="editor">editor</Prim.Option>
            </Prim.Select>
            <Prim.Pressable
              onClick={add}
              paddingHorizontal="$3"
              paddingVertical="$2"
              borderRadius="$md"
              backgroundColor="$primary"
            >
              <Prim.Text color="$primary-foreground" fontSize="$sm">
                Add
              </Prim.Text>
            </Prim.Pressable>
          </Prim.Row>
        </Prim.Box>
      ) : null}
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/$teamId/members')({
  component: MembersPage,
})
