// This file mirrors one Lightpanda browser tool. It is one of a family of thin,
// self-contained wrappers (per the "space functions are self-contained" rule) that
// forward a JSON-RPC `tools/call` to a running Lightpanda MCP server. Browser state
// (current page, cookies, node ids) lives in that server's single default session, so
// calls are stateful across the turn. Endpoint: `LIGHTPANDA_MCP_URL` (default
// http://127.0.0.1:9223). Tool description below is migrated verbatim from Lightpanda's
// own tool catalog so the model sees exactly what their agent sees.

/**
 * Extract structured data from the current page (navigate first). `schema` is a JSON object (passed as a string) mapping output field names to CSS-selector specs. It is NOT a JSON Schema — no "type"/"properties" wrappers; the keys ARE your output fields. Value shapes:
 *   "<sel>"                                → first match's text (trimmed; null if no match)
 *   ["<sel>"]                              → every match's text (string[])
 *   {"selector":"<sel>","attr":"<name>"}   → first match's attribute value (href/src resolved to absolute URLs)
 *   [{"selector":"<sel>","attr":"<name>"}] → every match's attribute (string[])
 *   [{"selector":"<sel>","fields":{…}}]    → one object per match; field selectors resolve relative to that match and accept any shape above ("" = the match's own text; nest arrays for per-item sub-lists)
 * Add "limit": N inside any array's object spec to cap matches.
 * Every extracted value is a string or null — parse numbers downstream. An empty array is a valid result, but if ALL top-level keys miss, the call errors: inspect the page (tree/markdown) and retry with corrected selectors.
 * Finish data tasks with extract — it is the read recorded as a replayable extract(...) script call; answers lifted from markdown text in chat are not.
 * Examples (schema → result):
 *   {"karma": "#karma"} → {"karma":"42"}
 *   {"items": [".story .title"]} → {"items":["Title 1","Title 2"]}
 *   {"links": [{"selector":"a.title","attr":"href"}]} → {"links":["https://site/a","https://site/b"]}
 *   {"stories": [{"selector":".athing","fields":{"title":".titleline","rank":".rank"}}]} → {"stories":[{"title":"Foo","rank":"1"}]}
 */
export async function extract(args: { schema: string; save?: string }): Promise<{ ok: boolean; text: string; isError: boolean; error?: string }> {
  const endpoint = (process.env['LIGHTPANDA_MCP_URL'] ?? 'http://127.0.0.1:9223').replace(/\/+$/, '');
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'extract', arguments: args } };
  let res: { ok: boolean; status: number; json: () => unknown; text: () => string };
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (e) {
    return { ok: false, text: '', isError: true, error: `lightpanda unreachable at ${endpoint} (${String(e)}) — start it with \`lightpanda serve\` (or \`lightpanda mcp\`) and/or set LIGHTPANDA_MCP_URL` };
  }
  if (!res.ok) {
    return { ok: false, text: '', isError: true, error: `lightpanda MCP returned HTTP ${res.status}` };
  }
  const rpc = res.json() as { result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }; error?: { code?: number; message?: string } };
  if (rpc.error) {
    return { ok: false, text: '', isError: true, error: rpc.error.message ?? `MCP error ${rpc.error.code ?? ''}`.trim() };
  }
  const text = (rpc.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  const failed = rpc.result?.isError === true;
  return { ok: !failed, text, isError: failed };
}
