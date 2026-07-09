---
description: Excel/ODS/CSV spreadsheets — everything arrives as CSV; how to parse rows, columns, and multiple sheets.
---

# Spreadsheets (Excel `.xlsx`/`.xls`, OpenDocument `.ods`, CSV/TSV)

The host extracts every spreadsheet to **CSV text** with SheetJS, so `doc.text` is
always comma-separated values no matter the source format. Parse it yourself and compute
the answer from the data — never invent rows or numbers.

Reading the CSV:

- The **first row is usually the header** (column names). Use it to identify which
  column holds which quantity before you filter/sum/average.
- Split on newlines for rows, then on commas for cells. Values containing commas,
  quotes, or newlines are **quoted** (`"1,200"`); strip the wrapping quotes and don't
  split inside them.
- Numbers may carry currency symbols, thousands separators, or `%` — normalise before
  arithmetic (e.g. `"$1,200"` → `1200`). Empty cells are empty strings.
- **Dates** may appear as serials or ISO strings depending on the source; read them as
  written and don't reformat unless asked.

Multiple sheets:

- A multi-sheet workbook arrives as CSV blocks, **each headed by `# Sheet: <name>`**.
  Treat each block as a separate table with its own header row. A single-sheet workbook
  (or a raw CSV/TSV) has no such header — it is just one table.

Answering:

- Show the key figures behind your answer (the count, total, or rows you used) so it is
  verifiable, but keep it concise plain text.
- If no specific question was asked, describe each table: its columns, row count, and
  what it appears to contain.
- If `doc.truncated` is true, later rows were cut — say your figures cover only the rows
  you received.
