/**
 * Shims for OpenClaw's `openclaw/plugin-sdk/*` entry-builder subpaths, so a
 * real, unmodified plugin entry file can be loaded via {@link loadPlugin}
 * without depending on the real `openclaw` npm package (this host has no
 * npm-registry egress). Wired in as {@link loadPlugin}'s builtin module shims.
 *
 * See `org/docs/libs/openclaw-compat.md` § "Loading a real extension".
 */

/**
 * `openclaw/plugin-sdk/plugin-entry` → `definePluginEntry`.
 *
 * The real `definePluginEntry` is an identity function: it takes a
 * `{ id, name, description, register(api) {...} }` definition and returns it
 * unchanged — the host later calls `.register(api)` on the entry file's
 * default export. This shim reproduces exactly that (proven against the
 * vendored Tavily `index.ts` in `../test/tavily/index.ts`).
 */
export function definePluginEntry<T>(def: T): T {
  return def;
}

/** A lazily-resolved module reference in a bundled-channel descriptor
 *  (`{ specifier, exportName }`) — points at the channel's socket/native
 *  runtime, which this host does NOT load (see below). */
export interface BundledEntryModuleRef {
  specifier: string;
  exportName?: string;
}

/** The descriptor passed to {@link defineBundledChannelEntry} — the subset
 *  this compat host reads. Extra fields are kept verbatim on `raw`. */
export interface BundledChannelDescriptor {
  id: string;
  name?: string;
  description?: string;
  importMetaUrl?: string;
  /** The channel's socket/native runtime module — recorded, NOT loaded. */
  plugin?: BundledEntryModuleRef;
  secrets?: BundledEntryModuleRef;
  runtime?: BundledEntryModuleRef;
  /** Webhook-mode hook: mounts the channel's own HTTP routes on the host
   *  (e.g. Slack's `registerSlackPluginHttpRoutes`). This is the part that
   *  becomes reachable through the Triggers inbound ingress. */
  registerFull?: (api: unknown) => unknown | Promise<unknown>;
  [key: string]: unknown;
}

/**
 * Apply a bundled-channel descriptor against the compat `api`:
 *   1. record the channel (metadata + the lazy `plugin`/`runtime` refs) — the
 *      socket/native runtime behind `descriptor.plugin.specifier` is NOT
 *      loaded here (that's the deferred Socket-Mode / warm-pod part); and
 *   2. run `registerFull(api)` when present — the WEBHOOK-MODE path, which
 *      mounts the channel's HTTP routes (reachable via the Triggers ingress).
 *
 * Shared by {@link defineBundledChannelEntry}'s generated `register` and by
 * {@link loadPlugin}'s raw-descriptor fallback, so both take the same path.
 */
export async function applyBundledChannelDescriptor(descriptor: BundledChannelDescriptor, api: unknown): Promise<void> {
  const a = api as {
    registerChannel(reg: Record<string, unknown>): unknown;
    log?(msg: string): void;
  };
  a.registerChannel({
    id: descriptor.id,
    name: descriptor.name,
    plugin: descriptor.plugin,
    raw: descriptor,
  });
  if (typeof descriptor.registerFull === 'function') {
    await descriptor.registerFull(api);
  } else {
    a.log?.(
      `[openclaw-compat] bundled channel "${descriptor.id}" has no registerFull (webhook-mode) hook — ` +
        'recorded only; its Socket-Mode runtime is not loaded (see org/docs/libs/openclaw-compat.md)',
    );
  }
}

/**
 * `openclaw/plugin-sdk/channel-entry-contract` → `defineBundledChannelEntry`.
 *
 * The real helper returns a `{ id, register(api) }` plugin entry whose
 * `register` loads the channel plugin from `plugin.specifier` and calls
 * `api.registerChannel(...)`. This shim returns the same entry shape but takes
 * the {@link applyBundledChannelDescriptor} path — recording the channel and
 * running the webhook-mode `registerFull` hook, WITHOUT loading the
 * socket/native runtime module.
 */
export function defineBundledChannelEntry(descriptor: BundledChannelDescriptor): {
  id: string;
  name?: string;
  description?: string;
  register(api: unknown): Promise<void>;
} {
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    register: (api: unknown) => applyBundledChannelDescriptor(descriptor, api),
  };
}
