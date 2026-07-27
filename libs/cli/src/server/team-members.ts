/**
 * The team's member directory — who is in this team, and what they are called.
 *
 * A team pod already knows a caller's id and email (Envoy projects them from the
 * team token, see `team-guard.ts`), but neither is a name anyone wants to read in
 * a channel, and neither is something you can type. This is the writable layer on
 * top: a **handle** you pick for yourself and an optional display name.
 *
 * On disk, `<lmthingRoot>/.team/members.json`:
 *
 *   [{ userId, email, handle?, displayName?, joinedAt, updatedAt }]
 *
 * The roster fills itself. Every request that carries a verified caller upserts
 * that caller ({@link touchMember}), so a member exists in the directory from the
 * first moment they open the surface — which is what makes the mention picker and
 * the DM list useful on day one, without an invite-time write path that would have
 * to be kept in step with the gateway's own membership table.
 *
 * The gateway's `team_members` table remains the authority on WHO is a member and
 * with what role. This file never grants access to anything; it is a display and
 * addressing layer, and a stale row here is a stale name, not a stale permission.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { teamDir } from './team-channels.js';

export interface TeamMemberProfile {
  userId: string;
  email?: string;
  /** The `@`-typeable name. Unique within the team, case-insensitively. */
  handle?: string;
  /** A free-form name shown in preference to the handle. */
  displayName?: string;
  joinedAt: string;
  updatedAt: string;
}

function membersFile(root: string): string {
  return join(teamDir(root), 'members.json');
}

/**
 * Handles that cannot be claimed.
 *
 * `thing` is the one that matters: `@thing` is how a message addresses the agent
 * (`mentionsThing`), so a member holding that handle would silently make every
 * mention of them a call to THING. The rest are the broadcast words a channel
 * surface conventionally reserves — none of them are implemented yet, and taking
 * them now costs nothing while leaving them free would make implementing them a
 * breaking rename for whoever grabbed one.
 */
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'thing',
  'here',
  'channel',
  'everyone',
  'all',
]);

/**
 * A handle is typed after an `@` and scanned back out of free text by
 * {@link resolveMentions}, so it is restricted to characters that cannot end a
 * mention ambiguously: no spaces, no `@`, and nothing that would need escaping
 * in that pattern.
 */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,31}$/.test(handle);
}

/** Normalize a typed handle: `@Ana.K ` → `ana.k`. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export async function listMembers(root: string): Promise<TeamMemberProfile[]> {
  let text: string;
  try {
    text = await readFile(membersFile(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (m): m is TeamMemberProfile =>
        !!m && typeof m === 'object' && typeof (m as TeamMemberProfile).userId === 'string',
    );
  } catch {
    return [];
  }
}

async function saveMembers(root: string, members: TeamMemberProfile[]): Promise<void> {
  await mkdir(teamDir(root), { recursive: true });
  await writeFile(membersFile(root), JSON.stringify(members, null, 2), 'utf8');
}

export async function getMember(
  root: string,
  userId: string,
): Promise<TeamMemberProfile | null> {
  return (await listMembers(root)).find((m) => m.userId === userId) ?? null;
}

/**
 * Record that this member exists (and their current email), without touching a
 * handle or display name they chose. Called on every identified request, so it
 * must stay cheap and must never fail a request: a directory that missed a write
 * is a name that is briefly absent from a picker, not an error worth surfacing.
 */
export async function touchMember(
  root: string,
  userId: string,
  email?: string,
): Promise<void> {
  if (!userId) return;
  try {
    const members = await listMembers(root);
    const existing = members.find((m) => m.userId === userId);
    if (existing) {
      // Only the email can drift underneath us; a chosen handle is theirs.
      if (!email || existing.email === email) return;
      existing.email = email;
      existing.updatedAt = new Date().toISOString();
      await saveMembers(root, members);
      return;
    }
    const now = new Date().toISOString();
    await saveMembers(root, [
      ...members,
      { userId, ...(email ? { email } : {}), joinedAt: now, updatedAt: now },
    ]);
  } catch {
    /* a directory row is not worth failing the request it rode in on */
  }
}

export class HandleError extends Error {}

/**
 * Set a member's handle and/or display name.
 *
 * Passing `handle: null` clears it; omitting the key leaves it alone — the
 * difference matters because a member editing only their display name must not
 * silently drop the handle other people already type.
 */
export async function setProfile(
  root: string,
  userId: string,
  patch: { handle?: string | null; displayName?: string | null; email?: string },
): Promise<TeamMemberProfile> {
  const members = await listMembers(root);
  const now = new Date().toISOString();
  let member = members.find((m) => m.userId === userId);
  if (!member) {
    member = { userId, joinedAt: now, updatedAt: now };
    members.push(member);
  }

  if (patch.handle !== undefined) {
    if (patch.handle === null || patch.handle.trim() === '') {
      delete member.handle;
    } else {
      const handle = normalizeHandle(patch.handle);
      if (!isValidHandle(handle)) {
        throw new HandleError(
          'a handle is 2–32 characters of lowercase letters, digits, dot, dash or underscore, starting with a letter or digit',
        );
      }
      if (RESERVED_HANDLES.has(handle)) {
        throw new HandleError(`@${handle} is reserved`);
      }
      const taken = members.some((m) => m.userId !== userId && m.handle === handle);
      if (taken) throw new HandleError(`@${handle} is already taken`);
      member.handle = handle;
    }
  }

  if (patch.displayName !== undefined) {
    const name = patch.displayName?.trim() ?? '';
    if (name) member.displayName = name.slice(0, 64);
    else delete member.displayName;
  }

  if (patch.email) member.email = patch.email;
  member.updatedAt = now;
  await saveMembers(root, members);
  return member;
}

/**
 * What to call this member on screen, best first: the name they chose, then the
 * handle others type, then the email the token carried, then the raw id.
 */
export function memberLabel(member: TeamMemberProfile | undefined, fallback: string): string {
  return member?.displayName || (member?.handle ? `@${member.handle}` : '') || member?.email || fallback;
}

/**
 * Resolve `@handle` mentions in a message to the members they name.
 *
 * Used to turn what someone typed into the ids a notification or an audit would
 * need. Unknown handles are simply not returned — a message may legitimately
 * contain an `@` that names nobody, and inventing a member for it would be worse
 * than ignoring it.
 */
export function resolveMentions(
  text: string,
  members: readonly TeamMemberProfile[],
): TeamMemberProfile[] {
  const byHandle = new Map(members.filter((m) => m.handle).map((m) => [m.handle!, m]));
  const found = new Map<string, TeamMemberProfile>();
  for (const match of text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9._-]{1,31})/gi)) {
    const member = byHandle.get(match[1]!.toLowerCase());
    if (member) found.set(member.userId, member);
  }
  return [...found.values()];
}
