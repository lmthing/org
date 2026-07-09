/**
 * `PluginRegistry` — the one-way sink a loaded plugin writes into via the
 * compat `api` (mirrors OpenClaw's own design: plugins register things into
 * a host-owned registry, they never read it back through `api`). The host
 * (pod) reads the registry after `loadPlugin` resolves to wire tools/routes/
 * channels into the rest of lmthing.
 */

import type { RegisteredChannel, RegisteredHttpRoute, RegisteredTool } from './types.js';

export class PluginRegistry {
  private readonly _tools = new Map<string, RegisteredTool>();
  private readonly _httpRoutes: RegisteredHttpRoute[] = [];
  private readonly _channels: RegisteredChannel[] = [];

  /** Record a tool registration. Throws on a duplicate name (fail loud). */
  addTool(tool: RegisteredTool): void {
    if (this._tools.has(tool.name)) {
      throw new Error(`[openclaw-compat] duplicate tool registration: "${tool.name}"`);
    }
    this._tools.set(tool.name, tool);
  }

  /** Record an HTTP route registration. */
  addHttpRoute(route: RegisteredHttpRoute): void {
    this._httpRoutes.push(route);
  }

  /** Record a channel registration. */
  addChannel(channel: RegisteredChannel): void {
    this._channels.push(channel);
  }

  /** All registered tools, keyed by name. */
  get tools(): ReadonlyMap<string, RegisteredTool> {
    return this._tools;
  }

  /** All registered HTTP routes, in registration order. */
  get httpRoutes(): readonly RegisteredHttpRoute[] {
    return this._httpRoutes;
  }

  /** All registered channels, in registration order. */
  get channels(): readonly RegisteredChannel[] {
    return this._channels;
  }

  /** Look up a single registered tool by name. */
  getTool(name: string): RegisteredTool | undefined {
    return this._tools.get(name);
  }
}
