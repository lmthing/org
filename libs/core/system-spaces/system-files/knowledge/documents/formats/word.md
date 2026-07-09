---
description: Word documents (.docx) — how officeparser flattens body, footnotes, and endnotes to text.
---

# Word (`docx`)

Extracted with **officeparser** (reads the OOXML zip in memory). `doc.text` contains
the document body in reading order, followed by any **footnotes** and **endnotes**.

What to expect and watch for:

- **Paragraphs** are separated by newlines. Runs within a paragraph are concatenated,
  so bold/italic/colour styling is invisible — judge emphasis from wording, not format.
- **Tables** are flattened to text: cell text appears in order but column/row structure
  is not preserved. If the user asks about a table, reason from the values present and
  note that exact alignment isn't guaranteed. For genuinely tabular data a spreadsheet
  export would read better (that is the `sheet` specialist's job, not yours).
- **Footnotes/endnotes** follow the main text — a number in the body maps to a note
  further down. Headers, footers, comments, and tracked-changes markup are generally
  not included.
- Images, charts, and embedded objects are dropped entirely (only their alt text, if
  any, might appear).
- **Legacy `.doc`** (old binary Word) is not supported — extraction fails and you get
  an `ok: false` result; tell the user to re-save as `.docx`.
