/**
 * Local navigation path helpers for the pod-backed, drill-down nav. The studio
 * surface is mounted at the `/studio` prefix inside the unified web app, so
 * every path is rooted under `/studio`:
 *   `/studio`                    → projects list (landing)
 *   `/studio/$projectId`         → a project's spaces
 *   `/studio/$projectId/$spaceId`→ a space editor
 *
 * Previously the ui lib reached into the studio app via `@/lib/space-url`
 * (which carried `$username` and `$storageId` segments). The pod-backed
 * architecture collapses those, so the lib now owns a tiny self-contained
 * helper and the studio app decides exact path wiring.
 */

const STUDIO_PREFIX = '/studio'

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

/** `/studio/$projectId` — the spaces listing for a project. */
export function buildProjectPath(projectId: string | null | undefined): string {
  if (!projectId) return STUDIO_PREFIX
  return `${STUDIO_PREFIX}/${enc(projectId)}`
}

/** `/studio/$projectId/$spaceId` — a space editor (SpaceProvider hydrates). */
export function buildSpacePath(
  projectId: string | null | undefined,
  spaceId: string | null | undefined,
): string {
  if (!projectId) return STUDIO_PREFIX
  if (!spaceId) return buildProjectPath(projectId)
  return `${STUDIO_PREFIX}/${enc(projectId)}/${enc(spaceId)}`
}
