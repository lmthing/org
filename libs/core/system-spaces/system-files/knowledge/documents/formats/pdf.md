---
description: PDF (application/pdf) — how the extracted text behaves and when it comes back empty.
---

# PDF (`application/pdf`)

Extracted with **unpdf**. `doc.text` is the concatenation of the text layer of every
page, in page order, pages joined by newlines.

What to expect and watch for:

- **Scanned / image-only PDFs have no text layer** — extraction yields nothing and
  `readDocument` comes back `ok: false` with an error like *"no extractable text
  (likely a scanned/image-only PDF)"*. Do not guess the contents; tell the user it
  looks like a scan and can't be read as text (a future OCR path would be needed).
- **Layout is lost.** Multi-column pages, tables, and headers/footers are flattened
  into linear text — columns may interleave and table cells may run together. Read
  generously and don't over-trust exact row/column alignment.
- **Page breaks** appear as newlines, not explicit markers; there are no reliable page
  numbers in the text unless the document itself printed them.
- Ligatures, hyphenation at line breaks, and soft hyphens can split or join words —
  normalise mentally when matching terms.
- Very long PDFs may be **truncated** (`doc.truncated === true`) — say your answer
  covers only the portion you received if completeness matters.
