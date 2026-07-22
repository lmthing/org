// This file mirrors one Lightpanda browser tool. It is one of a family of thin,
// self-contained wrappers (per the "space functions are self-contained" rule) that
// forward a JSON-RPC `tools/call` to a running Lightpanda MCP server. Browser state
// (current page, cookies, node ids) lives in that server's single default session, so
// calls are stateful across the turn. Endpoint: `LIGHTPANDA_MCP_URL` (default
// http://127.0.0.1:9223). Tool description below is migrated verbatim from Lightpanda's
// own tool catalog so the model sees exactly what their agent sees.

/**
 * Details for a node by backendNodeId: a ready-to-use CSS `selector` that resolves to the node (the first match, as click/fill resolve it), plus tag, role, name, interactivity, disabled, value, input type, placeholder, href, id, class, checked, select options. The canonical way to turn a tree backendNodeId into a CSS selector.
 */
export async function nodeDetails(args: { backendNodeId: number }): Promise<{ ok: boolean; text: string; isError: boolean; error?: string }> {
  const endpoint = (process.env['LIGHTPANDA_MCP_URL'] ?? 'http://127.0.0.1:9223').replace(/\/+$/, '');
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nodeDetails', arguments: args } };
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
