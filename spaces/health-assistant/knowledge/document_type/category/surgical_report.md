---
title: Surgical Report
description: Operative reports — procedure, date, surgeon, findings, technique, complications, and specimens
order: 8
---

# Surgical Report

## Required Fields

Every surgical report extraction must return the following structured fields:

```json
{
  "documentType": "surgical_report",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "surgeryDate": "YYYY-MM-DD | null",
  "facility": "string | null",
  "procedure": {
    "primary": "string — the main procedure performed",
    "additional": ["string | null"],
    "cptCodes": ["string | null"],
    "icd10ProcedureCodes": ["string | null"],
    "laterality": "left | right | bilateral | midline | central | none | null",
    "approach": "open | laparoscopic | robotic | endoscopic | arthroscopic | percutaneous | other | null",
    "urgency": "elective | urgent | emergent | null"
  },
  "surgeon": {
    "name": "string | null",
    "npi": "string | null"
  },
  "assistant": "string | null",
  "anesthesiologist": "string | null",
  "anesthesiaType": "general | regional | local | MAC | sedation | combined | null",
  "preoperativeDiagnosis": "string | null",
  "postoperativeDiagnosis": "string | null",
  "findings": "string — full operative findings section",
  "technique": "string — description of the surgical technique used",
  "specimens": [
    {
      "type": "string",
      "laterality": "string | null",
      "pathologyRequested": "boolean | null"
    }
  ],
  "implants": [
    {
      "name": "string",
      "manufacturer": "string | null",
      "lotNumber": "string | null",
      "size": "string | null",
      "location": "string | null"
    }
  ],
  "complications": {
    "intraoperative": ["string | null"],
    "estimatedBloodLoss": "string | null",
    "drainsPlaced": ["string | null"]
  },
  "disposition": "string | null — PACU | ICU | floor | discharged | null",
  "summary": "string — brief plain-language summary of the procedure"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| OR | Operating Room |
| Pre-op / Post-op | Preoperative / Postoperative |
| PACU | Post-Anesthesia Care Unit — recovery room immediately after surgery |
| EBL | Estimated Blood Loss |
| MAC | Monitored Anesthesia Care — sedation with local anesthesia |
| CPT | Current Procedural Terminology — procedure billing codes |
| ICD-10-PCS | Procedure Coding System — inpatient procedure codes |
| Laterality | Left / Right / Bilateral — which side was operated on |
| Approach | How the surgeon accessed the surgical site (open, laparoscopic, robotic, etc.) |
| Findings | What the surgeon observed upon entering the surgical field |
| Specimen | Tissue or fluid removed and sent to pathology |
| Implant | Device or material left in the patient (mesh, screws, plates, joint prosthesis) |
| Drain | Tube left in place to remove fluid (Jackson-Pratt, Penrose, chest tube) |
| Complication | Unexpected adverse event during surgery |
| Disposition | Where the patient went after surgery |
| Closure | How the surgical incision was closed (sutures, staples, glue) |
| Tourniquet time | Duration of blood flow restriction (in extremity surgery) |
| Sponge count | Verification that all surgical sponges were accounted for |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in operative/surgical reports.

Analyze the provided document image and extract the surgical report into structured JSON.

Instructions:
1. Identify the patient and surgery date.
2. Extract the primary procedure performed and any additional procedures. Use the exact wording from the document.
3. Extract CPT and ICD-10 procedure codes if listed.
4. Determine the laterality (left/right/bilateral/midline/none).
5. Determine the surgical approach:
   - "open" if a traditional incision was made.
   - "laparoscopic" if minimally invasive with camera.
   - "robotic" if robot-assisted (da Vinci, etc.).
   - "endoscopic" if through a natural body opening with scope.
   - "arthroscopic" if joint surgery with scope.
   - "percutaneous" if through needle puncture.
6. Determine urgency: elective (scheduled), urgent (needs surgery soon), or emergent (immediate).
7. Extract the surgeon, assistant surgeon, and anesthesiologist names.
8. Extract the type of anesthesia used.
9. Extract both preoperative and postoperative diagnoses.
10. Extract the FULL findings section — what the surgeon observed in the surgical field.
11. Extract the FULL technique/description of procedure section — the step-by-step operative narrative.
12. List ALL specimens removed and whether pathology was requested.
13. List ALL implants placed (joint replacements, mesh, screws, plates, stents, etc.) with manufacturer, lot number, and size if available.
14. Document any intraoperative complications.
15. Extract estimated blood loss (EBL).
16. Note any drains placed and their type.
17. Extract the patient disposition after surgery (PACU, ICU, floor, discharged).

Return ONLY valid JSON matching the surgical_report schema. Use null for any field not found in the document.
```

## Edge Cases

- **Dictated reports**: Surgical reports are often dictated by the surgeon and transcribed. Look for transcription artifacts, homophone errors (e.g., "ileum" vs "ilium"), and formatting inconsistencies.
- **Multi-procedure reports**: A single operative session may involve multiple distinct procedures (e.g., "cholecystectomy with intraoperative cholangiogram"). List each as a separate procedure.
- **Addenda**: Surgeons may add addenda to correct or supplement the original report. These are appended after the main report — extract them and note they are addenda.
- **Template reports**: Many surgical reports use pre-filled templates with blanks filled in. Sections may contain boilerplate text — extract it as-is.
- **Missing sections**: Some shorter operative notes (e.g., for minor procedures) may skip findings, technique detail, or EBL. Set missing fields to null.
- **Handwritten operative notes**: Occasionally found for emergency surgeries or in resource-limited settings. Mark illegible sections with `[ILLEGIBLE]`.
- **Implant documentation**: Implant stickers/cards are sometimes attached to the report. These contain lot numbers and manufacturer details critical for recall tracking.
- **Robotic surgery details**: Robotic cases may include console time, docking time, and robot model. Extract if available.
- **Pathology results pending**: Specimens sent to pathology will have results in a separate pathology report. Note "pathology pending" for these specimens.
- **Burn cases / debridement**: These may use specific terminology (% body surface area, depth, etc.) not common in other surgical reports.
