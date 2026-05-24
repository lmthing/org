---
title: Lab Results
description: Blood tests, panels, and pathology reports — CBC, CMP, lipid, thyroid, HbA1c, liver/renal, urinalysis, and pathology
order: 1
---

# Lab Results

## Required Fields

Every lab result extraction must return the following structured fields:

```json
{
  "documentType": "lab_results",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "collectionDate": "YYYY-MM-DD | null",
  "reportDate": "YYYY-MM-DD | null",
  "orderingProvider": "string | null",
  "performingLab": "string | null",
  "results": [
    {
      "testName": "string",
      "testCode": "string | null",
      "value": "string",
      "unit": "string | null",
      "referenceRange": "string | null",
      "flag": "normal | low | high | critical_low | critical_high | abnormal | null",
      "method": "string | null",
      "comment": "string | null"
    }
  ],
  "specimenType": "string | null",
  "accessionNumber": "string | null",
  "summary": "string — brief plain-language summary of notable findings"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| CBC | Complete Blood Count — WBC, RBC, Hgb, Hct, MCV, MCH, MCHC, PLT |
| CMP | Comprehensive Metabolic Panel — glucose, electrolytes, BUN, creatinine, liver enzymes |
| BMP | Basic Metabolic Panel — subset of CMP (glucose, Ca, electrolytes, BUN, Cr) |
| HbA1c | Glycated hemoglobin — 3-month average blood glucose indicator |
| TSH | Thyroid Stimulating Hormone |
| T3 / T4 | Triiodothyronine / Thyroxine — thyroid function markers |
| LDL / HDL / VLDL | Lipoprotein fractions in lipid panel |
| ALT / AST | Alanine / Aspartate aminotransferase — liver enzyme markers |
| BUN | Blood Urea Nitrogen — kidney function |
| eGFR | Estimated Glomerular Filtration Rate — kidney function |
| CRP | C-Reactive Protein — inflammation marker |
| ESR | Erythrocyte Sedimentation Rate — inflammation marker |
| INR | International Normalized Ratio — coagulation |
| PSA | Prostate-Specific Antigen |
| Reference range | Normal value interval for a given test |
| Flag / Abnormal | Indicator that a value falls outside reference range |
| Critical value | Potentially life-threatening result requiring immediate action |
| Unit | Measurement unit (mg/dL, mmol/L, x10^3/uL, etc.) |
| Accession # | Lab tracking number for the specimen |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in laboratory test results.

Analyze the provided document image and extract ALL lab test results into structured JSON.

Instructions:
1. Identify the patient demographics (name, DOB, patient ID) from the header.
2. Locate the collection date and report date.
3. For EACH individual test result row:
   - Extract the test name exactly as printed (do not abbreviate unless the source does).
   - Extract the numeric value and its unit of measure.
   - Extract the reference range (low–high).
   - Determine the flag status:
     * "normal" if value is within reference range or no flag is shown.
     * "high" if value exceeds the upper reference bound or is marked H / ↑ / HIGH.
     * "low" if value is below the lower reference bound or is marked L / ↓ / LOW.
     * "critical_high" if marked C / CRITICAL / ** / Panic.
     * "critical_low" if marked C / CRITICAL / ** / Panic (low side).
     * "abnormal" for qualitative results flagged as abnormal.
4. If the document contains a panel header (e.g., "Comprehensive Metabolic Panel"), include it as context but still list individual tests separately.
5. Extract any free-text comments or interpretive notes attached to results.
6. If the document is a urinalysis, extract both dipstick and microscopic results.
7. If the document is a pathology report, extract the diagnosis, specimen source, and any staging/grading information.

Return ONLY valid JSON matching the lab_results schema. Use null for any field not found in the document.
```

## Edge Cases

- **Multiple pages**: Lab reports often span 2–5 pages. Each page must be processed and results merged by accession number. Watch for continuation headers.
- **Reference ranges differ by lab**: The same test (e.g., TSH) may have different reference ranges depending on the performing lab. Always extract the printed reference range, never assume a default.
- **Handwritten addenda**: Occasionally a technician adds a handwritten note or correction. Flag these as `"comment": "[HANDWRITTEN] <text>"`.
- **Partial results / pending**: Some tests may show "PENDING" or "NOT PERFORMED". Include these with `"value": null` and `"comment": "PENDING"` or `"NOT PERFORMED"`.
- **Units mismatch**: Some labs report in mg/dL while others use mmol/L. Extract units exactly as printed — never convert.
- **Blurred or faint text**: Common on faxed or scanned lab reports. If a value is illegible, set `"value": null` and `"comment": "[ILLEGIBLE]"`.
- **Tables with merged cells**: Some reports merge rows for panel groupings. Each individual test must still be its own result object.
- **Historical comparison columns**: Many lab reports show previous values alongside current ones. Extract only the current/most recent result unless the document is explicitly a trend report.
- **Pediatric reference ranges**: Reference ranges differ by age/sex. Extract the printed range only — do not normalize.
- **Qualitative results**: Tests like pregnancy (hCG), COVID, or strep may show "Positive"/"Negative" rather than numeric values. Use the literal text as `"value"`.
