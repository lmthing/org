---
description: Plain text, Markdown, JSON, and source code — returned verbatim as UTF-8.
---

# Plain text, Markdown, JSON & code

Any text media type (`text/*`, `application/json`, YAML, Markdown, source files, etc.)
is decoded as **UTF-8 and returned verbatim** — no parsing, no reformatting. `doc.text`
is exactly the file's bytes as text.

- **Markdown** keeps its raw syntax (`#`, `-`, `**`, links). Read through the markup;
  the user usually wants the prose, not a lecture on the formatting.
- **JSON / YAML / TOML** arrive as raw source. You may reason over the structure by
  reading it, but it is a string — it is not parsed into an object for you. Quote exact
  values rather than guessing.
- **Source code** is verbatim. Answer about what the code does, defines, or imports from
  the text you see; don't invent symbols that aren't there.
- Long files may be **truncated** (`doc.truncated === true`) — the tail is cut, so a
  "does X appear anywhere" answer can only speak to the portion you received.
- Because these are decoded directly (no extractor), they essentially never fail unless
  the bytes aren't valid UTF-8.
