---
title: Doctor Notes
description: Clinical visit notes — SOAP format, assessment, plan, and encounter documentation
order: 3
---

# Doctor Notes

## Required Fields

Every doctor notes extraction must return the following structured fields:

```json
{
  "documentType": "doctor_notes",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "encounterDate": "YYYY-MM-DD | null",
  "encounterType": "office_visit | telehealth | urgent_care | er | follow_up | null",
  "provider": {
    "name": "string | null",
    "specialty": "string | null",
    "npi": "string | null",
    "facility": "string | null"
  },
  "chiefComplaint": "string | null",
  "soap": {
    "subjective": "string — patient's reported symptoms, history of present illness",
    "objective": "string — vitals, physical exam findings, test results reviewed",
    "assessment": "string — diagnoses, clinical impressions, differential diagnoses",
    "plan": "string — treatment plan, orders, referrals, follow-up, patient education"
  },
  "diagnoses": [
    {
      "description": "string",
      "icd10Code": "string | null",
      "isPrimary": "boolean | null"
    }
  ],
  "medicationsReviewed": ["string | null"],
  "orders": {
    "labs": ["string | null"],
    "imaging": ["string | null"],
    "referrals": ["string | null"],
    "prescriptions": ["string | null"]
  },
  "followUp": "string | null",
  "totalVisitTime": "string | null",
  "summary": "string — brief plain-language summary of the visit"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| SOAP | Subjective, Objective, Assessment, Plan — standard clinical note format |
| HPI | History of Present Illness — detailed narrative of the current complaint |
| ROS | Review of Systems — systematic check of organ systems |
| PMH / PSH | Past Medical History / Past Surgical History |
| FH / SH | Family History / Social History |
| PE | Physical Examination |
| H&P | History and Physical — comprehensive admission note |
| Progress note | Daily inpatient note tracking clinical course |
| CC | Chief Complaint — the patient's primary reason for the visit |
| Dx / DDx | Diagnosis / Differential Diagnosis |
| ICD-10 | International Classification of Diseases, 10th Revision — diagnosis codes |
| CPT | Current Procedural Terminology — procedure/billing codes |
| E/M | Evaluation and Management — visit type coding level |
| DNR / Full code | Do Not Resuscitate / Full resuscitation status |
| NKDA | No Known Drug Allergies |
| Follow-up | Scheduled or recommended return visit |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in clinical visit notes and encounter documentation.

Analyze the provided document image and extract the clinical note into structured JSON.

Instructions:
1. Identify the encounter date and type of visit (office, telehealth, urgent care, ER, follow-up).
2. Identify the provider (name, specialty, NPI if available, facility name).
3. Extract the Chief Complaint (CC) — the patient's stated reason for the visit.
4. Extract the SOAP sections:
   - Subjective: Patient's reported symptoms, HPI, relevant medical history, medications, allergies.
   - Objective: Vitals (if documented), physical exam findings, lab/imaging results reviewed during visit.
   - Assessment: Diagnoses (primary and secondary), clinical reasoning, differential diagnoses.
   - Plan: Treatment decisions, new prescriptions, lab/imaging orders, referrals, patient education, follow-up timing.
5. For each diagnosis listed:
   - Extract the diagnosis description.
   - Extract the ICD-10 code if shown (format: letter + 2 digits + optional decimal, e.g., E11.9).
   - Mark the primary diagnosis if indicated.
6. Extract all orders placed (lab tests, imaging studies, referrals, new prescriptions).
7. Extract the follow-up instructions (timeframe and/or specific instructions).
8. Some notes use non-SOAP formats (e.g., narrative notes, specialty-specific templates). In that case, map the content to the SOAP fields as best as possible and note the original format in a comment.

Return ONLY valid JSON matching the doctor_notes schema. Use null for any field not found in the document.
```

## Edge Cases

- **Non-SOAP formats**: Some specialists (psychiatrists, dermatologists, ophthalmologists) use their own note templates. Map the content to the SOAP structure as closely as possible. If a section has no clear equivalent, merge into the most relevant SOAP field.
- **Illegible handwriting**: Especially common with older notes or handwritten addenda. Transcribe what is legible and mark uncertain text with `[?]`. Completely illegible sections should be noted as `[ILLEGIBLE]`.
- **Pre-populated templates**: EHR systems (Epic, Cerner, etc.) often have pre-filled normal exam text (e.g., "Neck: Supple, no lymphadenopathy"). Extract this as-is — do not assume it was individually verified.
- **Copy-forward notes**: Providers sometimes copy notes from prior visits. Look at the encounter date carefully and note if content appears to reference a prior visit.
- **Multi-page notes**: Complex encounters (H&P, discharge planning) may span multiple pages. Merge all sections into a single note object.
- **Verbal addenda**: If the provider dictated an addendum or correction, extract it as part of the relevant SOAP section with a note like `[ADDENDUM: ...]`.
- **Scanned/faxed notes**: Thermal paper faxes degrade over time. Watch for faded text, skewed scans, and dark backgrounds that obscure content.
- **Abbreviations**: Medical notes are heavily abbreviated. Transcribe abbreviations as-is in the text fields. Common ones should be interpretable by downstream systems.
- **Signed vs. unsigned notes**: Some documents show "DRAFT" or are unsigned. Note the signature status if visible.
- **Encounter time**: Some notes include time-in/time-out. Extract total visit time if available.
