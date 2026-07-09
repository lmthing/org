---
variable: documentFormats
---

The reader handles prose/document formats — PDF, Word (`docx`), PowerPoint (`pptx`),
OpenDocument text/presentation (`odt`/`odp`), and plain text/Markdown/JSON/code. The
host extracts each to a single plain-text string (`doc.text`); layout, fonts, colours,
and images are dropped. Load the aspect for the specific type you were handed before
you answer, so you interpret its text correctly and know its failure modes.
