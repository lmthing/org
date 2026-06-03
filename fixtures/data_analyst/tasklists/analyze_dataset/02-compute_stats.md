---
id: compute_stats
dependsOn:
  - load_data
output:
  column_stats: object
  summary: string
---

For each numeric column identified in load_data.numeric_columns, load the full CSV using loadCSV() and compute statistics with computeStats(). Return column_stats (object mapping column name to stats object) and a text summary of the key findings.
