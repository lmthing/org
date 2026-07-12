/**
 * `@lmthing/openclaw-compat` — foundation for a pod-side host that can run
 * OpenClaw plugins (Phase 5, "OpenClaw messaging extensions as-is"). See
 * `org/docs/libs/openclaw-compat.md` for the feasibility/gap report against real OpenClaw
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
  RegisteredProvider,
  RegisteredTool,
  RegisteredToolExecute,
  RegisteredToolResult,
  RegisteredToolResultContent,
} from './types.js';
export { UnsupportedCompatError } from './types.js';

export { PluginRegistry } from './registry.js';

export { createCompatApi } from './api.js';
export type { OpenClawPluginApiLike, CreateCompatApiOptions } from './api.js';

export { loadPlugin } from './loader.js';
export type { LoadPluginResult, LoadPluginOptions } from './loader.js';

export {
  definePluginEntry,
  defineBundledChannelEntry,
  applyBundledChannelDescriptor,
} from './plugin-sdk-shim.js';
export type { BundledChannelDescriptor, BundledEntryModuleRef } from './plugin-sdk-shim.js';
