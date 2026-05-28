import type { RenderHost } from '../session/types.js';

/**
 * Create the `display` global. Fire-and-forget: pushes a descriptor to the
 * render surface. Does NOT trigger a yield or end the turn.
 */
export function createDisplayGlobal(renderHost: RenderHost): (descriptor: unknown) => void {
  return function display(descriptor: unknown): void {
    renderHost.display(descriptor);
  };
}
