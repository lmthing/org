---
title: Imaging Report
description: Radiology and imaging reports — X-ray, MRI, CT, ultrasound findings and impressions
order: 5
---

# Imaging Report

## Required Fields

Every imaging report extraction must return the following structured fields:

```json
{
  "documentType": "imaging_report",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "examDate": "YYYY-MM-DD | null",
  "reportDate": "YYYY-MM-DD | null",
  "accessionNumber": "string | null",
  "orderNumber": "string | null",
  "modality": "X-ray | MRI | CT | Ultrasound | PET | Nuclear | Mammography | Fluoroscopy | other",
  "bodyPart": "string",
  "studyDescription": "string | null",
  "contrastUsed": "boolean | null",
  "contrastType": "string | null",
  "orderingProvider": "string | null",
  "performingProvider": "string | null",
  "radiologist": "string | null",
  "facility": "string | null",
  "clinicalIndication": "string | null",
  "technique": "string | null",
  "comparison": "string | null",
  "findings": "string — the full findings section text",
  "impression": "string — the full impression/conclusion section text",
  "diagnoses": [
    {
      "finding": "string",
      "laterality": "left | right | bilateral | central | midline | null",
      "severity": "normal | mild | moderate | severe | critical | null"
    }
  ],
  "recommendations": ["string | null"],
  "summary": "string — brief plain-language summary of key findings"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| Modality | Type of imaging (X-ray, CT, MRI, US, PET, etc.) |
| Findings | Detailed descriptive section of what the radiologist observes |
| Impression | The radiologist's conclusion/summary — the most clinically relevant section |
| Technique | How the study was performed (e.g., "Axial and coronal T1/T2 with and without contrast") |
| Clinical indication / History | The reason the study was ordered |
| Comparison | Prior studies referenced for comparison |
| Contrast | Radioactive or magnetic contrast agent used to enhance visibility |
| Lucency / Opacity | Dark / light area on X-ray — can indicate pathology |
| Enhancement | Area that lights up with contrast — can indicate tumor or inflammation |
| Mass / Lesion | Abnormal tissue area requiring characterization |
| Effusion | Fluid accumulation (pleural, pericardial, joint) |
| Fracture | Bone break — described as transverse, spiral, comminuted, etc. |
| Degenerative changes | Wear-and-tear changes (osteoarthritis, disc disease) |
| Soft tissue | Non-bony tissues (muscles, ligaments, tendons, fat) |
| Hounsfield units (HU) | CT density measurement scale |
| Sequence | MRI acquisition type (T1, T2, FLAIR, DWI, STIR, etc.) |
| Laterality | Left / Right / Bilateral |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in radiology and imaging reports.

Analyze the provided document image and extract the imaging report into structured JSON.

Instructions:
1. Identify the modality (X-ray, MRI, CT, Ultrasound, PET, Nuclear Medicine, Mammography, Fluoroscopy, or other).
2. Identify the body part examined (e.g., "Chest", "Left Knee", "Lumbar Spine", "Abdomen and Pelvis").
3. Extract the study description / protocol (e.g., "MRI Brain with and without contrast").
4. Note whether contrast was used and what type (gadolinium, iodinated, barium, etc.).
5. Extract the clinical indication / reason for the study.
6. Extract the technique section (imaging parameters, sequences, views).
7. Extract any comparison studies referenced (date and type).
8. Extract the FULL findings section — do not summarize or truncate. This section contains detailed descriptions.
9. Extract the FULL impression section — this is the radiologist's conclusion and the most important part.
10. From the impression, extract individual diagnoses/findings:
    - Each separate finding should be its own entry.
    - Note laterality (left/right/bilateral) if specified.
    - Assess severity based on the radiologist's language:
      * "normal", "no acute findings", "unremarkable" → "normal"
      * "mild", "minimal", "slight", "trace" → "mild"
      * "moderate" → "moderate"
      * "severe", "significant", "marked" → "severe"
      * "critical", "emergent", "acute", "concerning for malignancy" → "critical"
11. Extract any follow-up recommendations (e.g., "Recommend MRI for further evaluation", "Follow-up in 6 months").

Return ONLY valid JSON matching the imaging_report schema. Use null for any field not found in the document.
```

## Edge Cases

- **Preliminary vs. final reports**: Some documents are preliminary reads (especially overnight/weekend). Look for "PRELIMINARY" watermark or header. A final report may follow later with changes.
- **Addendum reports**: Radiologists may issue addenda to correct or add findings. These are separate documents that reference the original report by accession number.
- **Multi-part studies**: Some studies (e.g., "CT Chest/Abdomen/Pelvis") cover multiple body regions in one report. Extract the full body part as listed.
- **Measurement values**: Tumor sizes, vessel diameters, disc heights, etc. are critical. Extract measurements with units (cm, mm).
- **BI-RADS / Lung-RADS / TI-RADS**: Standardized scoring systems for mammography, lung CT, and thyroid ultrasound. Extract the category number (e.g., "BI-RADS 4").
- **Prior comparison references**: Reports often compare to prior studies by date. Extract the comparison date and study type.
- **Negative findings**: "No pleural effusion", "No pneumothorax", "No acute fracture" are important negative findings. Include them in the findings section.
- **Incidental findings**: Unexpected findings not related to the clinical indication (e.g., incidental lung nodule on an abdominal CT). These are clinically important — capture them.
- **Handwritten notes**: Some older reports or addenda are handwritten. Mark illegible sections with `[ILLEGIBLE]`.
- **Scrolled/truncated reports**: Long CT or MRI reports may extend beyond a single image frame. If the document appears truncated, note it in the summary.
