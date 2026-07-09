// STUB standing in for the real
// github.com/openclaw/openclaw extensions/tavily/src/tavily-search-provider.ts.
//
// The real `createTavilyWebSearchProvider()` returns a `WebSearchProviderPlugin`
// (`{ ...buildTavilyWebSearchProviderBase(), createTool: (ctx) => {...} }`)
// whose `createTool` lazily imports `./tavily-client.js` (→ `@tavily/core`)
// to actually run a search. `@tavily/core` isn't installable in this sandbox
// (no npm-registry egress), so this stub reproduces only the real function's
// EXPORT SIGNATURE closely enough to exercise
// `@lmthing/openclaw-compat`'s `registerWebSearchProvider` recording. See
// ../../../COMPAT.md.
//
// Real signature: `export function createTavilyWebSearchProvider(): WebSearchProviderPlugin`.

export function createTavilyWebSearchProvider() {
  return {
    id: 'tavily',
    search: async (_query: string) => ({ results: [] }),
  };
}
