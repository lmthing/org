---
title: Discharge Summary
description: Hospital discharge summaries — admission/discharge dates, diagnoses, medications, procedures, and follow-up
order: 9
---

# Discharge Summary

## Required Fields

Every discharge summary extraction must return the following structured fields:

```json
{
  "documentType": "discharge_summary",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "mrn": "string | null",
  "admissionDate": "YYYY-MM-DD | null",
  "dischargeDate": "YYYY-MM-DD | null",
  "lengthOfStay": "number | null — in days",
  "admittingProvider": "string | null",
  "attendingProvider": "string | null",
  "facility": "string | null",
  "admissionType": "emergency | elective | urgent | transfer | observation | null",
  "admittingDiagnosis": "string | null",
  "dischargeDiagnoses": [
    {
      "description": "string",
      "icd10Code": "string | null",
      "isPrimary": "boolean | null"
    }
  ],
  "proceduresPerformed": [
    {
      "procedure": "string",
      "date": "YYYY-MM-DD | null",
      "cptCode": "string | null"
    }
  ],
  "hospitalCourse": "string — narrative summary of the hospital stay",
  "significantFindings": "string | null",
  "conditionAtDischarge": "stable | improved | unchanged | deteriorated | critical | null",
  "dischargeMedications": [
    {
      "drugName": "string",
      "dose": "string",
      "frequency": "string",
      "duration": "string | null",
      "isNew": "boolean | null",
      "isChanged": "boolean | null"
    }
  ],
  "medicationsDiscontinued": ["string | null"],
  "allergies": [
    {
      "allergen": "string",
      "reaction": "string | null"
    }
  ],
  "pendingResults": ["string | null"],
  "followUp": [
    {
      "provider": "string | null",
      "specialty": "string | null",
      "timeframe": "string",
      "reason": "string | null"
    }
  ],
  "dischargeInstructions": "string | null",
  "diet": "string | null",
  "activityRestrictions": "string | null",
  "disposition": "home | rehab | snf | ltac | ama | expired | other | null",
  "summary": "string — brief plain-language summary"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| LOS | Length of Stay — number of days from admission to discharge |
| MRN | Medical Record Number |
| Hospital course | Narrative describing the day-by-day events during hospitalization |
| Dispo / Disposition | Where the patient went after discharge (home, rehab, SNF, etc.) |
| SNF | Skilled Nursing Facility |
| LTAC | Long-Term Acute Care hospital |
| AMA | Against Medical Advice — patient left before recommended |
| D/C | Discharge |
| DC'd | Discontinued (referring to medications) |
| Follow-up | Post-discharge appointments with providers |
| Discharge meds | Medication list at time of discharge — may differ from admission list |
| New start | Medication newly started during hospitalization |
| Condition at discharge | Patient's clinical status when leaving the hospital |
| WNL | Within Normal Limits |
| PRN | As needed |
| Activity / Diet | Post-discharge activity level and dietary restrictions |
| Pending results | Lab/imaging results not yet finalized at time of discharge |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in hospital discharge summaries.

Analyze the provided document image and extract the discharge summary into structured JSON.

Instructions:
1. Extract patient demographics (name, DOB, patient ID, MRN).
2. Extract admission and discharge dates. Calculate length of stay in days.
3. Extract the admitting provider, attending provider, and facility name.
4. Determine admission type: emergency, elective, urgent, transfer, or observation.
5. Extract the admitting diagnosis.
6. Extract ALL discharge diagnoses:
   - Each diagnosis should be a separate entry.
   - Include ICD-10 codes if shown.
   - Mark the primary discharge diagnosis.
7. Extract all procedures performed during the stay, with dates and CPT codes if available.
8. Extract the hospital course narrative — this is the most detailed section and should be captured in full.
9. Extract any significant findings (lab, imaging, pathology).
10. Determine the patient's condition at discharge based on the documented language:
    - "stable" or "condition stable" → "stable"
    - "improved" → "improved"
    - "unchanged" or "no change" → "unchanged"
    - "deteriorated" or "worsened" → "deteriorated"
    - "critical" or "unstable" → "critical"
11. Extract the discharge medication list:
    - For each medication, note whether it is new (started during admission) or changed (dose adjusted).
    - Include dose and frequency.
12. Extract any medications that were discontinued during the stay.
13. Extract the allergy list as documented.
14. Extract any pending results (tests still outstanding at discharge).
15. Extract ALL follow-up appointments with provider, specialty, timeframe, and reason.
16. Extract discharge instructions, diet orders, and activity restrictions.
17. Determine the discharge disposition (home, rehab, SNF, LTAC, AMA, expired, other).

Return ONLY valid JSON matching the discharge_summary schema. Use null for any field not found in the document.
```

## Edge Cases

- **Lengthy hospital courses**: Complex admissions (ICU stays, multi-organ failure) may have very long hospital course narratives spanning pages. Capture the full text without summarizing.
- **Multiple discharge diagnoses**: Patients often leave with more diagnoses than they were admitted with (complications, newly discovered conditions). Extract ALL discharge diagnoses.
- **Medication reconciliation**: The discharge medication list is a reconciliation of pre-admission, in-hospital, and new medications. A medication may appear on both the "new" and "changed" lists.
- **Pending results at discharge**: Common for cultures, pathology, and specialized lab tests. These are critical for follow-up — always capture them.
- **Multidisciplinary notes**: Complex discharges may reference input from multiple specialists. Include these references in the hospital course.
- **Observation stays**: Some "discharge summaries" are actually observation status notes (less than 2 midnights). Note the admission type as "observation".
- **Readmission risk**: Some documents include readmission risk scores or care transition notes. Extract if present.
- **Faxed/scanned copies**: Discharge summaries are often faxed to PCPs. Watch for quality degradation.
- **Abbreviated format**: Some hospitals use abbreviated discharge summary templates. Extract all available sections and set missing ones to null.
- **AMA discharges**: Patients who leave against medical advice will have "AMA" noted. This has legal and clinical implications — always capture it.
