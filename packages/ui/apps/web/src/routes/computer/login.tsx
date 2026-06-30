import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from '@lmthing/auth'

export const Route = createFileRoute('/computer/login')({
  component: Login,
})

function Login() {
  const { isAuthenticated } = useAuth()
  if (isAuthenticated) return <Navigate to="/" />
  // LoginScreen is rendered by AuthGate in __root.tsx when not authenticated
  return null
}
