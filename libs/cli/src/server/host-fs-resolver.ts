import type { HostBridge } from '../rpc/host-bridge.js';
import type { HostFsOp } from '../rpc/host-events.js';

/**
 * Turn a `hostFs` yield into a request on the attached desktop.
 *
 * The pod's entire role here is **transport**. It does not check paths, does not know where the
 * granted folders are on disk, and never learns their absolute paths — the wire carries a `rootId`
 * and a relative path, and the enforcement is `apps/desktop/src-tauri/src/grants.rs`.
 *
 * That is deliberate and is the security design rather than a division of labour. The pod is the
 * party executing the untrusted instruction; asking it to police that instruction is asking the
 * attacker to check their own homework. A mirrored check here would look like defence in depth and
 * would in practice only invite someone to treat it as the boundary.
 *
 * The one thing this does own is **argument shaping**: the agent-facing globals take positional
 * arguments and the wire takes a named frame, so the mapping lives in one place rather than being
 * duplicated at six call sites.
 */
export function createHostFsResolver(bridge: HostBridge) {
  return async function hostFsResolver(op: string, args: unknown[]): Promise<unknown> {
    switch (op as HostFsOp) {
      case 'roots': {
        // Answered from the last pushed grant list rather than by a round trip: the desktop pushes
        // it on connect and on every change, so it is already current, and `localRoots()` is the
        // call an agent makes first — paying a WAN round trip to learn what it was already told
        // would be pure latency.
        return bridge.grants();
      }
      case 'tree': {
        const [rootId, path] = args as [string, string | undefined];
        return bridge.request({ type: 'fs.request', op: 'tree', rootId, ...(path ? { path } : {}) });
      }
      case 'stat': {
        const [rootId, path] = args as [string, string];
        return bridge.request({ type: 'fs.request', op: 'stat', rootId, path });
      }
      case 'read': {
        const [rootId, path, opts] = args as [
          string,
          string,
          { offset?: number; limit?: number } | undefined,
        ];
        return bridge.request({
          type: 'fs.request',
          op: 'read',
          rootId,
          path,
          ...(opts?.offset !== undefined ? { offset: opts.offset } : {}),
          ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
        });
      }
      case 'search': {
        const [rootId, query, opts] = args as [string, string, { path?: string } | undefined];
        return bridge.request({
          type: 'fs.request',
          op: 'search',
          rootId,
          query,
          ...(opts?.path ? { path: opts.path } : {}),
        });
      }
      case 'write': {
        const [rootId, path, content] = args as [string, string, string];
        // A longer budget than a read: the desktop may be prompting the person to confirm the
        // write, and a confirmation dialog that times out at 25s would refuse work they were in
        // the middle of approving.
        return bridge.request(
          { type: 'fs.request', op: 'write', rootId, path, content },
          { timeoutMs: 120_000 },
        );
      }
      default:
        throw new Error(`unknown local filesystem operation: ${op}`);
    }
  };
}

/**
 * The CDP half. Separate from the filesystem resolver because it is a separate capability and a
 * separate danger — and because the yield router has already made a person approve each call by the
 * time this runs (`hostCdp` is consent-marked, and fails closed with no prompter).
 *
 * A generous timeout: a `Page.navigate` on somebody's laptop can involve a real page load over a
 * real network, on top of the WAN hop to get there.
 */
export function createHostCdpResolver(bridge: HostBridge) {
  return async function hostCdpResolver(op: string, args: unknown[]): Promise<unknown> {
    const [a, b] = args as [unknown, unknown];
    return bridge.request(
      {
        type: 'cdp.request',
        method: op === 'command' ? String(a) : op,
        params:
          op === 'command'
            ? ((b ?? {}) as Record<string, unknown>)
            : op === 'subscribe'
              ? { domain: String(a) }
              : {},
      },
      { timeoutMs: 60_000 },
    );
  };
}
