---
id: group_analysis
dependsOn:
  - load_data
  - compute_stats
goal: true
output:
  groupings: object
  chart_data: object
  insights: array
  summary: string
---

Load the CSV and use groupBy() on the first categorical column from load_data.categorical_columns. Count rows per group and compute the mean of numeric columns per group. Return groupings (group counts), chart_data (group name → count), insights (3-5 key observations as strings), and a text summary.
