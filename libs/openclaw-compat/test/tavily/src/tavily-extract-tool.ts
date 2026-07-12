// STUB standing in for the real
// github.com/openclaw/openclaw extensions/tavily/src/tavily-extract-tool.ts.
//
// The real `createTavilyExtractTool(api, ctx)` builds a `typebox`-schema'd
// tool whose `execute` calls `runTavilyExtract(...)` from `./tavily-client.js`
// — a thin wrapper around the `@tavily/core` npm SDK. `@tavily/core` isn't
// installable in this sandbox (no npm-registry egress), so this stub
// reproduces only the real function's EXPORT SIGNATURE and return SHAPE
// (`{ name, description, parameters, execute(toolCallId, params) }`) closely
// enough to exercise `@lmthing/openclaw-compat`'s factory-form
// `registerTool` wiring end-to-end. See org/docs/libs/openclaw-compat.md.
//
// Real signature: `export function createTavilyExtractTool(api: OpenClawPluginApi, ctx?: TavilyToolConfigContext)`.

export function createTavilyExtractTool(_api: unknown, _ctx?: unknown) {
  return {
    name: 'tavily_extract',
    description: 'Extract clean content from URLs using Tavily (STUB — real impl needs @tavily/core).',
    parameters: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } } }, required: ['urls'] },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => ({
      content: [{ type: 'text', text: 'stub:' + JSON.stringify(params) }],
    }),
  };
}
