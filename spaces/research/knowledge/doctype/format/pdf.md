---
title: PDF
description: PDF documents — stream-parsed page-by-page via pdf-parse
order: 2
---

# PDF

PDFs are stream-parsed page-by-page. Always pass `pages: "1-N"` if the document is long — reading a whole 200-page PDF is the fastest way to torch a context budget.

**Patterns**
- Quick survey of a paper → `pages: "1-2"` (abstract + intro)
- Specific topic → search the page, then read that page ± 1
- OCR PDFs → `hasText: false` is returned; pipe to an OCR service externally

**Tuning**
- `byteBudget` caps the concatenated text returned across the selected pages.
- Page numbers are 1-indexed and inclusive on both sides.
