import { createFileRoute, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { AppProvider, ProjectProvider, SpaceProvider } from '@lmthing/state'
import { useAuth, useRepoSync } from '@lmthing/auth'
import { ComputerProvider, useComputer } from '@/lib/runtime/ComputerContext'
import { ComputerLayout } from '@lmthing/ui/computer'
import { PodEnsureGate } from '@/lib/gates'
import { useCallback, useEffect, useState } from 'react'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * Fetch the user's GitHub repo into memory when authenticated (see `useRepoSync`).
 * The files are NOT written to the pod filesystem — the callback only logs the
 * file count; wiring them into the pod is still TODO.
 */
function RepoSyncGate({ children }: { children: React.ReactNode }) {
  const { session, isAuthenticated } = useAuth()
  const githubToken = typeof window !== 'undefined' ? localStorage.getItem('github_token') : null

  const onFilesLoaded = useCallback((files: Record<string, string>) => {
    console.log(`[RepoSync] Loaded ${Object.keys(files).length} files from GitHub repo`)
  }, [])

  useRepoSync({
    session,
    isAuthenticated,
    githubToken,
    onFilesLoaded,
  })

  return <>{children}</>
}

function ComputerShell() {
  const { status, error, boot } = useComputer()
  const { session, authFetch } = useAuth()
  const router = useRouter()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type !== 'lmthing:navigate' || !e.data.path) return
      router.navigate({ to: e.data.path })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [router])

  const handleRestart = async () => {
    if (!session?.accessToken) return
    setRestarting(true)
    try {
      await authFetch(`${COMPUTER_BASE_URL}/api/restart`, { method: 'POST' })
    } catch { /* expected — pod exits */ }
    const poll = async () => {
      try {
        const r = await authFetch(`${COMPUTER_BASE_URL}/api/env`)
        if (r.ok) { setTimeout(() => window.location.reload(), 1500); return; }
      } catch { /* still down */ }
      setTimeout(poll, 800)
    }
    setTimeout(poll, 1000)
  }

  // IDE gets full-screen layout (no sidebar) at /computer.
  if (currentPath === '/computer') {
    return <Outlet />
  }

  return (
    <ComputerLayout
      status={status}
      tier="flyio"
      currentPath={currentPath}
      onNavigate={(path) => router.navigate({ to: path })}
      error={error}
      onRetry={boot}
      onRestart={() => { void handleRestart() }}
      restarting={restarting}
    >
      <Outlet />
    </ComputerLayout>
  )
}

/** Provider subtree rendered once the pod is ready (or when pod-embedded). */
function PodReadyTree({ children }: { children: React.ReactNode }) {
  const { getAccessToken, getAccessTokenSync, refreshAuth } = useAuth()
  return (
    <ComputerProvider computerBaseUrl={COMPUTER_BASE_URL} getAccessToken={getAccessToken}>
      <AppProvider
        pod={{
          podBaseUrl: COMPUTER_BASE_URL,
          getAccessToken: getAccessTokenSync,
          refresh: refreshAuth,
        }}
      >
        <ProjectProvider projectId="user">
          <SpaceProvider spaceId="default">
            {children}
          </SpaceProvider>
        </ProjectProvider>
      </AppProvider>
    </ComputerProvider>
  )
}

/**
 * `/computer` layout — computer-specific providers (repo sync, pod readiness,
 * ComputerProvider/AppProvider/Project/Space) wrapping the ComputerShell. Auth +
 * pin are provided by the shared root.
 */
function ComputerLayoutRoot() {
  return (
    <RepoSyncGate>
      <PodEnsureGate>
        <PodReadyTree>
          <ComputerShell />
        </PodReadyTree>
      </PodEnsureGate>
    </RepoSyncGate>
  )
}

export const Route = createFileRoute('/computer')({
  component: ComputerLayoutRoot,
})
