---
title: DOCX / Office
description: Word docs → markdown via mammoth
order: 3
---

# DOCX

Microsoft Word documents are converted to markdown via `mammoth`. Headings, lists, links, and basic styling are preserved; tables come through as markdown tables.

PPTX and XLSX are not yet handled in-process — convert externally (`libreoffice --headless --convert-to pdf`) or feed slides as PDFs.
