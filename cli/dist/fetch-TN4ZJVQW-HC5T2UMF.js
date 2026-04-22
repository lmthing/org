// ../repl/dist/fetch-TN4ZJVQW.js
import { writeFile } from "fs/promises";
var fetchModule = {
  id: "fetch",
  description: "HTTP request utilities",
  functions: [
    {
      name: "httpGet",
      description: "GET request, auto-parses JSON",
      signature: "(url: string, headers?: Record<string, string>) => Promise<any>",
      fn: async (url, headers) => {
        const res = await fetch(url, { headers });
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("json")) return res.json();
        return res.text();
      }
    },
    {
      name: "httpPost",
      description: "POST with JSON body",
      signature: "(url: string, body: any, headers?: Record<string, string>) => Promise<any>",
      fn: async (url, body, headers) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body)
        });
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return res.json();
        return res.text();
      }
    },
    {
      name: "httpPut",
      description: "PUT with JSON body",
      signature: "(url: string, body: any, headers?: Record<string, string>) => Promise<any>",
      fn: async (url, body, headers) => {
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body)
        });
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return res.json();
        return res.text();
      }
    },
    {
      name: "httpDelete",
      description: "DELETE request",
      signature: "(url: string, headers?: Record<string, string>) => Promise<any>",
      fn: async (url, headers) => {
        const res = await fetch(url, {
          method: "DELETE",
          headers
        });
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return res.json();
        return res.text();
      }
    },
    {
      name: "httpRequest",
      description: "Full control HTTP request",
      signature: "(options: RequestOptions) => Promise<{ status: number, headers: Record<string, string>, body: any }>",
      fn: async (options) => {
        const opts = options;
        const res = await fetch(opts.url, {
          method: opts.method ?? "GET",
          headers: opts.headers,
          body: opts.body ? JSON.stringify(opts.body) : void 0,
          signal: opts.timeout ? AbortSignal.timeout(opts.timeout) : void 0
        });
        const ct = res.headers.get("content-type") ?? "";
        const body = ct.includes("json") ? await res.json() : await res.text();
        const headers = {};
        res.headers.forEach((v, k) => {
          headers[k] = v;
        });
        return { status: res.status, headers, body };
      }
    },
    {
      name: "fetchPage",
      description: "Fetch webpage, extract readable text",
      signature: "(url: string) => Promise<{ title: string, text: string, links: string[] }>",
      fn: async (url) => {
        const res = await fetch(url);
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
        const title = titleMatch ? titleMatch[1].trim() : "";
        const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const links = [];
        const linkRegex = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          links.push(match[1]);
        }
        return { title, text: text.slice(0, 1e4), links: [...new Set(links)] };
      }
    },
    {
      name: "downloadFile",
      description: "Download to local file",
      signature: "(url: string, dest: string) => Promise<{ size: number }>",
      fn: async (url, dest) => {
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        await writeFile(dest, buffer);
        return { size: buffer.length };
      }
    }
  ]
};
var fetch_default = fetchModule;
export {
  fetch_default as default
};
