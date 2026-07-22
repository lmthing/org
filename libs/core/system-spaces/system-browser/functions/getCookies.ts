// This file mirrors one Lightpanda browser tool. It is one of a family of thin,
// self-contained wrappers (per the "space functions are self-contained" rule) that
// forward a JSON-RPC `tools/call` to a running Lightpanda MCP server. Browser state
// (current page, cookies, node ids) lives in that server's single default session, so
// calls are stateful across the turn. Endpoint: `LIGHTPANDA_MCP_URL` (default
// http://127.0.0.1:9223). Tool description below is migrated verbatim from Lightpanda's
// own tool catalog so the model sees exactly what their agent sees.

/**
 * Cookies stored in the browser. Defaults to cookies whose domain matches the current page's host. Pass `url=<URL>` to filter for another host, or `all=true` to dump every cookie regardless of host. Useful for debugging authentication and session state.
 */
export async function getCookies(args?: { url?: string; all?: boolean }): Promise<{ ok: boolean; text: string; isError: boolean; error?: string }> {
  const endpoint = (process.env['LIGHTPANDA_MCP_URL'] ?? 'http://127.0.0.1:9223').replace(/\/+$/, '');
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getCookies', arguments: args ?? {} } };
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
