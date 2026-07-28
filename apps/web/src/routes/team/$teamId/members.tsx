import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Card } from '@lmthing/ui/elements/content/card'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Avatar, AvatarFallback } from '@lmthing/ui/elements/content/avatar'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@lmthing/ui/elements/overlays/dialog'
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from '@lmthing/ui/elements/overlays/dropdown'
import { Mail, MoreVertical, Plus, UserMinus } from 'lucide-react'
import { initials } from '@lmthing/ui/team'
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
  const [addOpen, setAddOpen] = useState(false)
  const isEditor = team.role === 'editor'

  const load = useCallback(async () => {
    try {
      const team = await teamApi.get(authFetch, teamId)
      // Normalised once here so nothing below has to ask twice. Reading `detail?.members.length`
      // on a payload whose `members` key was absent took the whole page down with a raw
      // "Cannot read properties of undefined" — a list this page can render as empty instead.
      setDetail({ ...team, members: team.members ?? [], invites: team.invites ?? [] })
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
      setAddOpen(false)
      setNotice(
        result.status === 'added'
          ? `${result.email} joined the team.`
          : `${result.email} has no account yet — they'll see the invitation when they sign in at lmthing.team.`,
      )
    })
  }

  return (
    <Prim.Box padding="$6" maxWidth={720} overflow="auto" height="100%">
      <Prim.Row alignItems="center" justifyContent="space-between" marginBottom="$4">
        <Heading level={1}>Members</Heading>
        {isEditor ? (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus size={14} aria-hidden={true} />
                Add someone
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle asChild>
                  <Heading level={3}>Add someone</Heading>
                </DialogTitle>
              </DialogHeader>
              <Prim.Col gap="$3" marginTop="$3">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="their@email.com"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add()
                  }}
                />
                <Select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                  <SelectOption value="viewer">viewer</SelectOption>
                  <SelectOption value="editor">editor</SelectOption>
                </Select>
                <Prim.Row gap="$2" justifyContent="flex-end">
                  <DialogClose asChild>
                    <Button variant="ghost" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button size="sm" onClick={add} disabled={!email.trim()}>
                    Add
                  </Button>
                </Prim.Row>
              </Prim.Col>
            </DialogContent>
          </Dialog>
        ) : null}
      </Prim.Row>

      {error ? (
        <Caption color="$destructive" marginBottom="$3">
          {error}
        </Caption>
      ) : null}
      {notice ? <Caption marginBottom="$3">{notice}</Caption> : null}

      <Card marginBottom="$6">
        {(detail?.members ?? []).map((member, i) => (
          <Prim.Box key={member.user_id}>
            <ListItem paddingHorizontal="$4" paddingVertical="$3" cursor="default" hoverStyle={{ backgroundColor: 'transparent' }}>
              <Avatar size="sm">
                <AvatarFallback colorKey={member.user_id}>{initials(member.email)}</AvatarFallback>
              </Avatar>
              <Prim.Box flex={1} minWidth={0} marginLeft="$3">
                <Prim.Text fontSize="$sm">{member.email}</Prim.Text>
                {member.user_id === session?.userId ? <Caption marginLeft="$1.5">you</Caption> : null}
              </Prim.Box>
              <Badge variant={member.role === 'editor' ? 'primary' : 'muted'}>{member.role}</Badge>
              {isEditor ? (
                <Dropdown>
                  <DropdownTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical size={14} aria-hidden={true} />
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent>
                    <DropdownItem
                      onClick={() =>
                        void run(() =>
                          teamApi.setRole(
                            authFetch,
                            teamId,
                            member.user_id,
                            member.role === 'editor' ? 'viewer' : 'editor',
                          ),
                        )
                      }
                    >
                      Make {member.role === 'editor' ? 'viewer' : 'editor'}
                    </DropdownItem>
                    <DropdownItem
                      style={{ color: 'var(--destructive)' }}
                      onClick={() =>
                        void run(() => teamApi.removeMember(authFetch, teamId, member.user_id))
                      }
                    >
                      Remove
                    </DropdownItem>
                  </DropdownContent>
                </Dropdown>
              ) : member.user_id === session?.userId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void run(() => teamApi.removeMember(authFetch, teamId, member.user_id))}
                >
                  <UserMinus size={14} aria-hidden={true} />
                  Leave
                </Button>
              ) : null}
            </ListItem>
            {i < (detail?.members.length ?? 0) - 1 ? (
              <Prim.Box height={1} backgroundColor="$border" />
            ) : null}
          </Prim.Box>
        ))}
      </Card>

      {(detail?.invites.length ?? 0) > 0 ? (
        <Prim.Box marginBottom="$6">
          <Heading level={4} marginBottom="$2">
            Pending invitations
          </Heading>
          <Card>
            {(detail?.invites ?? []).map((invite, i) => (
              <Prim.Box key={invite.id}>
                <ListItem paddingHorizontal="$4" paddingVertical="$3" cursor="default" hoverStyle={{ backgroundColor: 'transparent' }}>
                  <Avatar size="sm">
                    <AvatarFallback colorKey={invite.id}>
                      <Mail size={14} aria-hidden={true} />
                    </AvatarFallback>
                  </Avatar>
                  <Prim.Box flex={1} minWidth={0} marginLeft="$3">
                    <Prim.Text fontSize="$sm">{invite.email}</Prim.Text>
                  </Prim.Box>
                  <Badge variant="muted">{invite.role}</Badge>
                  {isEditor ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void run(() => teamApi.revokeInvite(authFetch, teamId, invite.id))}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </ListItem>
                {i < (detail?.invites.length ?? 0) - 1 ? (
                  <Prim.Box height={1} backgroundColor="$border" />
                ) : null}
              </Prim.Box>
            ))}
          </Card>
        </Prim.Box>
      ) : null}
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/$teamId/members')({
  component: MembersPage,
})
