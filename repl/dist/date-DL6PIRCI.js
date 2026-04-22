// src/catalog/date.ts
function formatDateStr(date, format) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return format.replace("YYYY", String(date.getFullYear())).replace("MM", pad(date.getMonth() + 1)).replace("DD", pad(date.getDate())).replace("HH", pad(date.getHours())).replace("mm", pad(date.getMinutes())).replace("ss", pad(date.getSeconds()));
}
var dateModule = {
  id: "date",
  description: "Date/time utilities",
  functions: [
    {
      name: "now",
      description: "Current ISO 8601 timestamp",
      signature: "() => string",
      fn: () => (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      name: "parseDate",
      description: "Parse date string",
      signature: "(input: string) => Date",
      fn: (input) => new Date(input)
    },
    {
      name: "formatDate",
      description: 'Format date (e.g., "YYYY-MM-DD")',
      signature: "(date: Date | string, format: string) => string",
      fn: (date, format) => {
        const d = date instanceof Date ? date : new Date(date);
        return formatDateStr(d, format);
      }
    },
    {
      name: "addDays",
      description: "Date arithmetic \u2014 add days",
      signature: "(date: Date | string, days: number) => Date",
      fn: (date, days) => {
        const d = date instanceof Date ? new Date(date) : new Date(date);
        d.setDate(d.getDate() + days);
        return d;
      }
    },
    {
      name: "diffDays",
      description: "Days between two dates",
      signature: "(a: Date | string, b: Date | string) => number",
      fn: (a, b) => {
        const da = a instanceof Date ? a : new Date(a);
        const db = b instanceof Date ? b : new Date(b);
        return Math.round((db.getTime() - da.getTime()) / (1e3 * 60 * 60 * 24));
      }
    }
  ]
};
var date_default = dateModule;
export {
  date_default as default
};
