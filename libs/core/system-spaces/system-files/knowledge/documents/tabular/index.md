---
variable: tabularFormats
---

The sheet specialist handles tabular files — Excel (`xlsx`/`xls`), OpenDocument
spreadsheets (`ods`), and delimited text (`csv`/`tsv`). The host renders every one of
them to CSV text via SheetJS before you see it, so `doc.text` is always CSV regardless
of the original format. Load the `spreadsheet` aspect for how to parse and reason over
that CSV, including multi-sheet workbooks.
