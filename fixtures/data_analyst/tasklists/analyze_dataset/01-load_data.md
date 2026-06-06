---
id: load_data
output:
  headers: array
  row_count: number
  numeric_columns: array
  categorical_columns: array
---

Load the CSV file at the path in `filepath` seed variable using loadCSV(). Identify numeric vs categorical columns by checking if values can be parsed as numbers. Return headers, row_count, numeric_columns (array of column names), categorical_columns (array of column names).
