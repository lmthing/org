/**
 * Which team a team surface should select, given a REQUEST to focus one — a tap on a Home
 * dashboard row, a push notification's deep link, a desktop window restoring its last view — and
 * the member's own team list.
 *
 * A pure function on purpose: the decision ("does this request name a team the member is actually
 * on") is testable without a renderer, and getting it wrong in either direction is a real bug.
 * Silently landing on the WRONG team — matching by anything looser than an exact id — would be
 * worse than the ignored tap it replaces.
 */

/** The shape a team surface's own `TeamSummary[]` satisfies; only `id` is read. */
export interface FocusableTeam {
  id: string
}

/**
 * Never selects a team the member is not actually a member of — a stale invite id, a team they
 * left, or a deep link that outlived the membership must not swap them onto some OTHER team; the
 * current selection holds instead. Returns `currentId` unchanged whenever the request cannot (yet)
 * be honoured, which also covers `teams` still being `null`: the list has not loaded, so there is
 * nothing to check the request against yet.
 */
export function resolveFocusTeamId(
  teams: readonly FocusableTeam[] | null,
  requestedId: string | null | undefined,
  currentId: string | null,
): string | null {
  if (!requestedId || !teams) return currentId
  return teams.some((t) => t.id === requestedId) ? requestedId : currentId
}
