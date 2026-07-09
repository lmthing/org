/**
 * `@lmthing/openclaw-compat` — foundation for a pod-side host that can run
 * OpenClaw plugins (Phase 5, "OpenClaw messaging extensions as-is"). See
 * `../COMPAT.md` for the feasibility/gap report against real OpenClaw
 * plugins.
 */

export type {
  CompatHost,
  CompatHttpRequest,
  CompatHttpResponse,
  CompatRouteHandler,
  CompatRunAgentOptions,
  CompatRunAgentResult,
  RegisteredChannel,
  RegisteredHttpRoute,
  RegisteredTool,
  RegisteredToolExecute,
  RegisteredToolResult,
  RegisteredToolResultContent,
} from './types.js';
export { UnsupportedCompatError } from './types.js';

export { PluginRegistry } from './registry.js';

export { createCompatApi } from './api.js';
export type { OpenClawPluginApiLike } from './api.js';

export { loadPlugin } from './loader.js';
export type { LoadPluginResult } from './loader.js';
