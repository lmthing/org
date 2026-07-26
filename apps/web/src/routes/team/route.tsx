import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * `/team` layout — lmthing.team. Auth and the PIN gate come from the shared
 * root; a team's own providers (its token, its pod) start one level down, at
 * `/team/$teamId`, because this level is the list of teams you belong to and
 * needs nothing team-scoped.
 */
export const Route = createFileRoute('/team')({
  component: () => <Outlet />,
})
