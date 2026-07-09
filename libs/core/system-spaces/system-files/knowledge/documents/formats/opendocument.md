---
description: OpenDocument text & presentations (.odt/.odp) — LibreOffice/OpenOffice formats.
---

# OpenDocument text & presentation (`odt` / `odp`)

The OpenDocument counterparts of Word and PowerPoint, produced by LibreOffice/OpenOffice
and Google Docs/Slides exports. Extracted with **officeparser**.

- **`.odt`** (text document) behaves like `docx` — body paragraphs in reading order,
  newlines between them, styling dropped, tables flattened. See the `word` aspect for
  the same caveats about tables, footnotes, and lost formatting.
- **`.odp`** (presentation) behaves like `pptx` — slide text in order plus notes, no
  explicit slide markers, charts/images lost. See the `powerpoint` aspect.
- OpenDocument **spreadsheets** (`.ods`) are NOT handled here — they go to the `sheet`
  specialist, which reads them as tabular CSV. If you somehow receive one, say it should
  be routed to the spreadsheet reader.
- Treat the text exactly as you would the Microsoft equivalent; the only difference is
  the source application.
