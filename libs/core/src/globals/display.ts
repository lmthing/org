import type { RenderHost } from '../session/types.js';

/**
 * Create the `display` global. Fire-and-forget: pushes a descriptor to the
 * render surface. Does NOT trigger a yield or end the turn.
 *
 * `onDisplay` (optional) is an observability hook: the caller passes a closure
 * that writes an attributed `display` trace event (carrying the emitting node's
 * id), so the web UI/replay can show the output under the right node.
 */
export function createDisplayGlobal(
  renderHost: RenderHost,
  onDisplay?: (value: unknown) => void,
): (descriptor: unknown) => void {
  return function display(descriptor: unknown): void {
    // Coerce primitives to strings so `display(count)` / `display(true)` just work
    // (a common model pattern); objects/JSX descriptors pass through unchanged.
    const value =
      typeof descriptor === 'number' || typeof descriptor === 'boolean' || typeof descriptor === 'bigint'
        ? String(descriptor)
        : descriptor;
    renderHost.display(value);
    onDisplay?.(value);
  };
}
