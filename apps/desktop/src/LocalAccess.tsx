import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { DesktopHostBridge, HostBridgeState } from './host-bridge'

interface LocalPod {
  base: string
  port: number
}

interface StoredGrant {
  id: string
  path: string
  label: string
  mode: string
}

/**
 * Local access — the surface where a person decides what a cloud agent may touch on their machine.
 *
 * Three things here are part of the SECURITY design rather than decoration, and none should be
 * removed as clutter:
 *
 * 1. **The grant list is the only way in.** A folder appears here because the person picked it in
 *    an OS dialog. Nothing else can add one, and the agent cannot ask for one.
 * 2. **The activity log.** Every operation the pod performed, allowed or refused. Without it the
 *    honest answer to "what did it read?" is "no idea", which is not an acceptable answer for a
 *    feature that reads someone's disk.
 * 3. **The disconnect button.** Instant and total. The person clicking it is saying "stop now",
 *    and the pod fails every in-flight request the moment the socket drops.
 *
 * The path IS shown here, unlike over the bridge — the person chose it and is entitled to see it.
 * `grant_list_detailed` is a separate command from `grant_list` precisely so the path cannot reach
 * the agent by accident.
 */
export function LocalAccess({ bridge }: { bridge: DesktopHostBridge }) {
  const [grants, setGrants] = React.useState<StoredGrant[]>([])
  const [state, setState] = React.useState<HostBridgeState>({ status: 'idle', activity: [] })
  const [error, setError] = React.useState<string | null>(null)
  const [localPod, setLocalPod] = React.useState<LocalPod | null>(null)

  React.useEffect(() => bridge.subscribe(setState), [bridge])
  React.useEffect(() => {
    void invoke<LocalPod | null>('local_mode_status').then(setLocalPod).catch(() => {})
  }, [])

  /**
   * Switch between the cloud pod and a workspace running on this machine.
   *
   * Reloads afterwards, and that is not laziness: the bridge is injected before any page script and
   * read synchronously during module init, so a LIVE page cannot be repointed at a different pod.
   * It is also the honest behaviour — every socket, transcript and cached session belongs to the
   * pod being left behind.
   */
  const toggleLocal = React.useCallback(async () => {
    setError(null)
    try {
      if (localPod) await invoke('local_mode_disable')
      else await invoke<LocalPod>('local_mode_enable')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [localPod])

  const refresh = React.useCallback(async () => {
    try {
      setGrants(await invoke<StoredGrant[]>('grant_list_detailed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const addFolder = React.useCallback(
    async (mode: 'ro' | 'rw') => {
      setError(null)
      const picked = await open({ directory: true, multiple: false })
      if (typeof picked !== 'string') return
      try {
        await invoke('grant_add', {
          path: picked,
          label: picked.split(/[/\\]/).filter(Boolean).pop() ?? picked,
          mode,
        })
        await refresh()
        // The pod must never act on a stale list — a folder the person just revoked has to stop
        // being addressable immediately, not at the next reconnect.
        await bridge.refreshGrants()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [bridge, refresh],
  )

  const remove = React.useCallback(
    async (id: string) => {
      await invoke('grant_remove', { id })
      await refresh()
      await bridge.refreshGrants()
    },
    [bridge, refresh],
  )

  return (
    <Prim.Col flex={1} minHeight={0} padding="$4" gap="$4">
      <Prim.Col gap="$1">
        <Prim.Text fontSize="$xl" fontWeight="$bold">
          Local access
        </Prim.Text>
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          Folders your workspace agent may read on this computer. It can reach nothing else — not
          your home folder, not anything you have not listed here.
        </Prim.Text>
      </Prim.Col>

      <Prim.Row alignItems="center" gap="$2">
        <StatusDot status={state.status} />
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          {statusLabel(state)}
        </Prim.Text>
        <Prim.Box flex={1} />
        {state.status === 'connected' ? (
          <Button label="Disconnect" onPress={() => bridge.stop()} tone="destructive" />
        ) : (
          <Button label="Connect" onPress={() => bridge.start()} />
        )}
      </Prim.Row>

      {error ? (
        <Prim.Text fontSize="$sm" color="$destructive">
          {error}
        </Prim.Text>
      ) : null}

      <Prim.Col gap="$1" paddingVertical="$2" borderTopWidth={1} borderBottomWidth={1} borderColor="$border">
        <Prim.Row alignItems="center" gap="$2">
          <Prim.Text fontWeight="$semibold">Where your workspace runs</Prim.Text>
          <Prim.Box flex={1} />
          <Button
            label={localPod ? 'Switch to the cloud' : 'Run it on this computer'}
            onPress={() => void toggleLocal()}
          />
        </Prim.Row>
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {localPod
            ? `Running here, on port ${localPod.port}. Works offline; teams and notifications need the cloud.`
            : 'Running in the cloud. Switching runs it here instead — faster and offline, but no teams.'}
        </Prim.Text>
      </Prim.Col>

      <Prim.Row gap="$2">
        <Button label="Add folder (read only)" onPress={() => void addFolder('ro')} />
        <Button label="Add folder (read + write)" onPress={() => void addFolder('rw')} />
      </Prim.Row>

      <Prim.Col gap="$2">
        {grants.length === 0 ? (
          <Prim.Text fontSize="$sm" color="$muted-foreground">
            No folders shared. Your agent cannot see any of your files.
          </Prim.Text>
        ) : (
          grants.map((g) => (
            <Prim.Row
              key={g.id}
              alignItems="center"
              gap="$3"
              paddingVertical="$2"
              paddingHorizontal="$3"
              borderRadius="$radius-lg"
              backgroundColor="$muted"
            >
              <Prim.Col flex={1} minWidth={0}>
                <Prim.Text fontWeight="$medium">{g.label}</Prim.Text>
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  {g.path}
                </Prim.Text>
              </Prim.Col>
              <Prim.Text fontSize="$xs" color="$muted-foreground">
                {g.mode === 'rw' ? 'read + write' : 'read only'}
              </Prim.Text>
              <Button label="Remove" onPress={() => void remove(g.id)} tone="destructive" />
            </Prim.Row>
          ))
        )}
      </Prim.Col>

      <Prim.Col flex={1} minHeight={0} gap="$2">
        <Prim.Text fontWeight="$semibold">Recent activity</Prim.Text>
        {state.activity.length === 0 ? (
          <Prim.Text fontSize="$sm" color="$muted-foreground">
            Nothing yet.
          </Prim.Text>
        ) : (
          <Prim.Scroll flex={1}>
            <Prim.Col gap="$1">
              {state.activity.map((a, i) => (
                <Prim.Row key={`${a.at}-${i}`} gap="$2" alignItems="center">
                  <Prim.Text fontSize="$xs" color={a.ok ? '$muted-foreground' : '$destructive'}>
                    {a.ok ? 'ok' : 'refused'}
                  </Prim.Text>
                  <Prim.Text fontSize="$xs" color="$muted-foreground">
                    {a.op}
                  </Prim.Text>
                  <Prim.Text fontSize="$xs" flex={1}>
                    {a.path ?? ''}
                  </Prim.Text>
                  {a.error ? (
                    <Prim.Text fontSize="$xs" color="$destructive">
                      {a.error}
                    </Prim.Text>
                  ) : null}
                </Prim.Row>
              ))}
            </Prim.Col>
          </Prim.Scroll>
        )}
      </Prim.Col>
    </Prim.Col>
  )
}

function statusLabel(s: HostBridgeState): string {
  switch (s.status) {
    case 'connected':
      return 'Connected — your workspace can reach the folders below.'
    case 'connecting':
      return 'Connecting…'
    case 'evicted':
      return s.detail ?? 'Connected on another computer.'
    case 'error':
      return s.detail ?? 'Not connected.'
    default:
      return 'Not connected. Your agent cannot reach this computer.'
  }
}

function StatusDot({ status }: { status: HostBridgeState['status'] }) {
  const color =
    status === 'connected' ? '$primary' : status === 'error' ? '$destructive' : '$muted-foreground'
  return <Prim.Box width={8} height={8} borderRadius="$radius-full" backgroundColor={color} />
}

function Button({
  label,
  onPress,
  tone,
}: {
  label: string
  onPress: () => void
  tone?: 'destructive'
}) {
  return (
    <Prim.Pressable
      onClick={onPress}
      minHeight="$9"
      paddingHorizontal="$3"
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="$radius-md"
      borderWidth={1}
      borderColor="$border"
      hoverStyle={{ backgroundColor: '$muted' }}
      aria-label={label}
    >
      <Prim.Text fontSize="$sm" color={tone === 'destructive' ? '$destructive' : '$foreground'}>
        {label}
      </Prim.Text>
    </Prim.Pressable>
  )
}
