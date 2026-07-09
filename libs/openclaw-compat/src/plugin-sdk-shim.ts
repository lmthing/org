/**
 * A faithful shim for OpenClaw's `openclaw/plugin-sdk/plugin-entry` subpath.
 *
 * The real `definePluginEntry` is an identity function: it takes a
 * `{ id, name, description, register(api) {...} }` definition and returns it
 * unchanged (the shape-checking happens at the type level, not at runtime) —
 * the host later calls `.register(api)` directly on whatever a plugin's
 * entry file default-exports. This shim reproduces exactly that behavior so
 * a real, unmodified plugin entry (e.g. the vendored Tavily `index.ts` in
 * `../test/tavily/index.ts`) can be loaded via {@link loadPlugin}'s
 * `moduleOverrides`, without depending on the real `openclaw` npm package.
 *
 * See `../COMPAT.md` § "Loading a real extension (Tavily) — proven".
 */
export function definePluginEntry<T>(def: T): T {
  return def;
}
