/**
 * The slice of `expo-notifications` this app uses.
 *
 * The package is a declared dependency (`package.json`) but is not installed in
 * this working tree, and installing it would mean regenerating the ROOT
 * pnpm lockfile — which CI builds every image from, and which currently carries
 * an unrelated in-flight change. So the types are declared here rather than
 * pulled in, and `pnpm install` on a clean tree is what an actual Android build
 * needs.
 *
 * This is not a shim: nothing here executes. `src/push.ts` imports the real
 * module lazily inside a `try`, precisely so that a build without the native
 * module linked degrades to "no notifications" instead of failing to boot — the
 * same reason the runtime tolerates its absence is why the type can be declared
 * ahead of it.
 */
declare module 'expo-notifications' {
  export const AndroidImportance: { HIGH: number }

  export interface PermissionResponse {
    granted: boolean
    status: string
  }

  export function getPermissionsAsync(): Promise<PermissionResponse>
  export function requestPermissionsAsync(): Promise<PermissionResponse>
  export function getExpoPushTokenAsync(): Promise<{ data: string }>
  export function setNotificationChannelAsync(
    channelId: string,
    channel: { name: string; importance: number; vibrationPattern?: number[] },
  ): Promise<unknown>
}
