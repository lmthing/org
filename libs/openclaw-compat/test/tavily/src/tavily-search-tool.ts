// STUB standing in for the real
// github.com/openclaw/openclaw extensions/tavily/src/tavily-search-tool.ts.
//
// The real `createTavilySearchTool(api, ctx)` builds a `typebox`-schema'd
// tool whose `execute` calls `runTavilySearch(...)` from `./tavily-client.js`
// — a thin wrapper around the `@tavily/core` npm SDK. `@tavily/core` isn't
// installable in this sandbox (no npm-registry egress), so this stub
// reproduces only the real function's EXPORT SIGNATURE and return SHAPE
// (`{ name, description, parameters, execute(toolCallId, params) }`) closely
// enough to exercise `@lmthing/openclaw-compat`'s factory-form
// `registerTool` wiring end-to-end. See org/docs/libs/openclaw-compat.md.
//
// Real signature: `export function createTavilySearchTool(api: OpenClawPluginApi, ctx?: TavilyToolConfigContext)`.

export function createTavilySearchTool(_api: unknown, _ctx?: unknown) {
  return {
    name: 'tavily_search',
    description: 'Search the web using the Tavily Search API (STUB — real impl needs @tavily/core).',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => ({
      content: [{ type: 'text', text: 'stub:' + JSON.stringify(params) }],
    }),
  };
}
