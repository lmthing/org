// SYNTHETIC test fixture — proves the host <-> register(api) seam WITHOUT the
// real OpenClaw SDK (which this package does not depend on yet).
//
// A REAL OpenClaw plugin would instead write:
//
//   import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
//
//   export default definePluginEntry({
//     id: 'echo',
//     name: 'Echo',
//     description: '...',
//     register(api) { ... },
//   });
//
// See org/docs/libs/openclaw-compat.md for what wiring up the real `openclaw/plugin-sdk/*`
// subpaths requires.

function definePluginEntryLocal<T extends { id: string; register: (api: unknown) => unknown }>(entry: T): T {
  return entry;
}

export default definePluginEntryLocal({
  id: 'echo',
  register(api: any) {
    api.registerTool({
      name: 'echo',
      description: 'echo',
      parameters: {},
      execute: async (_id: string, p: { text: unknown }) => ({
        content: [{ type: 'text', text: String(p.text) }],
      }),
    });

    api.registerHttpRoute({
      method: 'POST',
      path: '/echo',
      handler: async (req: { body: unknown }) => {
        const r = await api.runtime.subagent.run({ sessionKey: 'echo', message: req.body });
        return { status: 200, body: r };
      },
    });
  },
});
