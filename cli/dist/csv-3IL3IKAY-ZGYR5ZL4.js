// ../repl/dist/csv-3IL3IKAY.js
import { readFile, writeFile } from "fs/promises";
function parseCsv(text, options) {
  const delimiter = options?.delimiter ?? ",";
  const hasHeader = options?.header !== false;
  const lines = text.trim().split("\n");
  if (lines.length === 0) return [];
  const parseRow = (line) => {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        values.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    values.push(current.trim());
    return values;
  };
  if (hasHeader && lines.length > 1) {
    const headers = parseRow(lines[0]);
    return lines.slice(1).filter((l) => l.trim()).map((line) => {
      const values = parseRow(line);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? "";
      });
      return obj;
    });
  }
  return lines.filter((l) => l.trim()).map(parseRow);
}
function stringifyCsv(data, options) {
  const delimiter = options?.delimiter ?? ",";
  const showHeader = options?.header !== false;
  if (data.length === 0) return "";
  const first = data[0];
  if (typeof first === "object" && first !== null && !Array.isArray(first)) {
    const keys = Object.keys(first);
    const lines = [];
    if (showHeader) lines.push(keys.join(delimiter));
    for (const row of data) {
      const obj = row;
      lines.push(keys.map((k) => escCsvVal(String(obj[k] ?? ""), delimiter)).join(delimiter));
    }
    return lines.join("\n");
  }
  return data.map((row) => {
    if (Array.isArray(row)) return row.map((v) => escCsvVal(String(v), delimiter)).join(delimiter);
    return String(row);
  }).join("\n");
}
function escCsvVal(val, delimiter) {
  if (val.includes(delimiter) || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
var csvModule = {
  id: "csv",
  description: "CSV processing",
  functions: [
    {
      name: "csvParse",
      description: "Parse CSV to array of objects/arrays",
      signature: "(text: string, options?: { header?: boolean, delimiter?: string }) => any[]",
      fn: (text, options) => parseCsv(text, options)
    },
    {
      name: "csvStringify",
      description: "Convert to CSV string",
      signature: "(data: any[], options?: { header?: boolean, delimiter?: string }) => string",
      fn: (data, options) => stringifyCsv(data, options)
    },
    {
      name: "csvReadFile",
      description: "Read and parse CSV file",
      signature: "(path: string, options?: CsvOptions) => Promise<any[]>",
      fn: async (path, options) => {
        const text = await readFile(path, "utf-8");
        return parseCsv(text, options);
      }
    },
    {
      name: "csvWriteFile",
      description: "Write data as CSV file",
      signature: "(path: string, data: any[], options?: CsvOptions) => Promise<void>",
      fn: async (path, data, options) => {
        const text = stringifyCsv(data, options);
        await writeFile(path, text, "utf-8");
      }
    }
  ]
};
var csv_default = csvModule;
export {
  csv_default as default
};
