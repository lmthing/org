/**
 * Leaving the app, and coming back — WEB implementation.
 *
 * Three things the chat surface does to `window.location`: open another lmthing surface, reload
 * after a pod restart, and set the document title. They are grouped because they are the same
 * question — *what does "the page" mean here?* — and on native the answer is "there isn't one".
 */

/** Navigate to an absolute URL (a cross-surface hop). Leaves the app on web. */
export function openUrl(url: string): void {
  window.location.href = url
}

/** Reload the app after the pod it is served from has restarted. */
export function reloadApp(): void {
  window.location.reload()
}

/**
 * The URL the app is currently at — handed to a provider as `redirect_to` / `return_url` so an
 * external OAuth or billing flow can send the user back.
 */
export function currentUrl(): string {
  return window.location.href
}

/** Set the window/tab title. */
export function setAppTitle(title: string): void {
  document.title = title
}
