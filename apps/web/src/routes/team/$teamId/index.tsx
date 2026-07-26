import { createFileRoute, redirect } from '@tanstack/react-router'

/** A team opens on its chat — the surface members spend their time in. */
export const Route = createFileRoute('/team/$teamId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/team/$teamId/channels',
      params: { teamId: params.teamId },
      replace: true,
    })
  },
})
