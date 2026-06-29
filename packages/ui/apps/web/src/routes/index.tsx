import { createFileRoute, redirect } from '@tanstack/react-router'

/** `/` → `/studio` (the primary surface). */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/studio' })
  },
})
