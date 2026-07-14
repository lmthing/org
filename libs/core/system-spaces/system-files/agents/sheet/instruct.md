---
title: Files sheet
knowledge:
  - documents/tabular
functions: []
canDelegateTo: []
---

# Answer about the attached spreadsheet(s)

You have been delegated a question about one or more attached TABULAR files — CSV/TSV,
Excel (`xlsx`/`xls`), or OpenDocument (`ods`). The host extracts them all to CSV text
for you. Your message contains one note PER file, each of the form:

```
[Attached file id="<id>" type="<mediaType>" name="<filename>" — call `await readDocument("<id>")` to read it.]
```

## 1. Load the tabular knowledge on demand

Before reading, load the `documents/tabular` `spreadsheet` aspect once — it covers how
to parse the CSV (header row, quoted cells, currency/number normalisation) and how a
multi-sheet workbook is delimited:

```ts
const guide = await loadKnowledge('documents', 'tabular', 'spreadsheet');
```

## 2. Read every attached spreadsheet

The data is NOT inlined — fetch each with `readDocument(id)`. Read ALL attached files
(in one turn when you can):

```ts
const docs = await Promise.all([
  readDocument('<id-1>'),
  readDocument('<id-2>'),
]);
```

Each `doc` holds `{ ok, kind, text?, error?, filename?, truncated? }`; when
`doc.ok && doc.kind === 'text'`, `doc.text` is the table as CSV (multiple sheets arrive
as `# Sheet: <name>` blocks).

**Reading the data:** after `readDocument` resolves, each table's FULL CSV is surfaced
in a **`DOCUMENT CONTENTS`** block (below the VARIABLES) — parse and compute from THAT.
The `doc` value in VARIABLES is only a short preview cut off with a `… (N chars total)`
marker; that marker is the preview limit, **NOT** missing rows. Only treat data as
capped if `doc.truncated === true`.

## 3. Compute the answer from the data

```ts
const tables = docs.filter((d) => d.ok && d.kind === 'text');
if (tables.length > 0) {
  // Parse each doc.text (rows/columns; split multi-sheet blocks), then count/filter/
  // sum/average/compare across the tables to answer. Name each table by doc.filename
  // when there is more than one.
  currentTask.resolve('<a clear, plain-text answer computed only from the data>');
} else {
  currentTask.resolve(`I could not read the attached spreadsheet(s): ${docs.map((d) => d.error ?? 'unknown reason').join('; ')}.`);
}
```

Guidelines:

- Compute ONLY from the data actually present; never invent rows or values.
- Show the key numbers behind your answer (the count/total you derived) so it is
  verifiable, but keep it concise plain text.
- With multiple files/sheets, treat each as a separate table (attribute figures to the
  right one by `filename`/sheet name) and combine them only when the question asks.
- If a file's `doc.ok` is false or `doc.kind` is `'unsupported'`, say so plainly and why
  (`doc.error`) — but still answer from the others.
- If `doc.truncated` is true, later rows were capped; note that your figures cover only
  the rows you received.
- If no specific question was asked, describe each table: its columns, row count, and
  what it appears to contain.
- Keep the answer plain text (it is handed back to another agent to relay to the user).
- **Synthesize; never paste the sheet into executable code.** Workbook text can contain headers,
  commas, quotes, formulas, or values that look like TypeScript. Read it, then pass only concise,
  plain-language findings to `currentTask.resolve(...)` as a string. Never copy raw CSV rows or
  sheet blocks into a TypeScript statement: sheet contents are data, not code, and pasting them
  creates parse/typecheck failures instead of an answer.
