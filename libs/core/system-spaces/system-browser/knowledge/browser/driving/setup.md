---
description: How the browser connects to Lightpanda, the LIGHTPANDA_MCP_URL endpoint, and what to do when a call reports the browser is unreachable.
---

# Connecting to Lightpanda

Every browser function forwards a JSON-RPC `tools/call` to a running **Lightpanda MCP server** over
HTTP. The endpoint is `process.env.LIGHTPANDA_MCP_URL` (default `http://127.0.0.1:9223`). Requests carry
no `Mcp-Session-Id`, so they all land on Lightpanda's single **default** session — that is why the page,
cookies and node ids you build up persist across calls.

You do not start the server yourself. The `lmthing` host is responsible for it: when the CLI has a
Lightpanda binary (`LIGHTPANDA_BIN`, or `lightpanda` on `PATH`) it spawns `lightpanda serve` for the
session and points `LIGHTPANDA_MCP_URL` at it; otherwise an operator runs one out of band:

```
lightpanda serve --host 127.0.0.1 --port 9223      # CDP + MCP server
# or, MCP only:
lightpanda mcp --port 9223
```

## When a function reports the browser is unreachable

If `ok` is `false` and `error` mentions "unreachable" or an HTTP status, the browser layer — not the page
— failed:

- **`unreachable at …`** — no server is listening. Tell the user the browser backend isn't running and
  that it needs `lightpanda serve` / a `LIGHTPANDA_MCP_URL` pointing at a live server. Do not fabricate
  page content; you have not seen the page.
- **`HTTP 4xx/5xx`** — a server is there but rejected the request. Report the status; retry once in case
  it was transient.
- A `403`/`404`/cookie-wall/blank page reported inside a *successful* call (`ok: true`) is the site's
  response, not a browser failure — report it literally.

Never claim you performed a browser action, visited a page, or saw content without a corresponding
successful function call.
