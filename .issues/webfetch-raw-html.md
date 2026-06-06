# webFetch returns raw HTML — no text extraction

## Summary

`webFetch()` returns the raw HTML source of a fetched page. For most agent use cases (reading articles, documentation, summaries), raw HTML is unusable without additional parsing.

## Impact

When the agent fetches a URL to read its content, it gets thousands of characters of HTML tags, CSS, and JavaScript instead of the actual text content. The agent can't meaningfully analyze or summarize the page.

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude \
  "Use webSearch to find a page about QuickJS, then webFetch the first result and summarize what you find."
```

webFetch returns raw HTML like `<!DOCTYPE html><html lang="en"><head>...` — not useful text.

## Fix options

- **(Best)** Use a simple HTML-to-text extraction (strip tags, decode entities) in the webFetch function. Could use a regex-based stripper or a lightweight library.
- **(Or)** Add a `format` option: `{ format: 'text' | 'html' }` defaulting to `'text'`.

## Location

`packages/core/system-spaces/web/functions/webFetch.ts`
