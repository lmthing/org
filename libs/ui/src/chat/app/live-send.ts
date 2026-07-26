/**
 * The send channel of the live session socket.
 *
 * `Sidebar` opens the WebSocket and three components need to push a message down it (`AppShell`,
 * `ChatView`, `Message`). That was done by assigning `window.__LM_SEND__` and reading it back —
 * which works only because a web page has exactly one global object, and is unreachable on React
 * Native, where there is no `window` to hang it from.
 *
 * A module-level reference is what a global was standing in for, and it is strictly better on web
 * too: the value is private to this package instead of writable by anything sharing the page, and
 * it is typed rather than cast at each of the four sites.
 *
 * Deliberately NOT in the zustand store: it is a live connection handle, not state. Putting it there
 * would notify every subscriber whenever a socket was swapped, re-rendering the whole surface for a
 * value nothing renders.
 */
type Send = (message: unknown) => void

let send: Send | null = null

/** Bind the live socket's send. Pass `null` when the connection closes. */
export function setLiveSend(next: Send | null): void {
  send = next
}

/** The live socket's send, or null when there is no open session. */
export function getLiveSend(): Send | null {
  return send
}
