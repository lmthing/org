---
title: Medication Label
description: Prescription and OTC medication labels — drug name, strength, directions, warnings, and expiration
order: 4
---

# Medication Label

## Required Fields

Every medication label extraction must return the following structured fields:

```json
{
  "documentType": "medication_label",
  "drugName": "string",
  "genericName": "string | null",
  "strength": "string | null",
  "dosageForm": "string | null",
  "manufacturer": "string | null",
  "lotNumber": "string | null",
  "ndc": "string | null",
  "expirationDate": "YYYY-MM-DD | null",
  "directions": "string — full directions as printed on label",
  "frequency": "string | null",
  "quantity": "string | null",
  "warnings": ["string"],
  "sideEffects": ["string"],
  "storageInstructions": "string | null",
  "pharmacy": {
    "name": "string | null",
    "address": "string | null",
    "phone": "string | null"
  },
  "prescriber": "string | null",
  "patientName": "string | null",
  "fillDate": "YYYY-MM-DD | null",
  "refillsRemaining": "number | null",
  "rxNumber": "string | null",
  "isOverTheCounter": "boolean",
  "summary": "string — brief plain-language description"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| NDC | National Drug Code — FDA identifier for the specific drug product |
| Lot / Batch # | Manufacturing lot number for traceability |
| Rx # | Prescription number assigned by the pharmacy |
| Sig | Directions for use |
| Exp / Expiration | Date beyond which the medication should not be used |
| MFG / Manufacturer | Company that produced the drug |
| Fill date | Date the prescription was dispensed |
| Refills remaining | Number of refills still available |
| OTC | Over-The-Counter — no prescription required |
| USP | United States Pharmacopeia — quality standard |
| CAP / Child-resistant | Cap type — child-resistant vs. easy-open |
| Auxiliary label | Additional warning labels (e.g., "Take with food", "May cause drowsiness") |
| DIN | Drug Identification Number (Canadian equivalent of NDC) |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in medication labels (both prescription and over-the-counter).

Analyze the provided document image of a medication bottle, box, or vial label and extract ALL information into structured JSON.

Instructions:
1. Identify whether this is a prescription or OTC medication:
   - Prescription: has Rx number, pharmacy info, prescriber name.
   - OTC: has brand name prominently, no Rx number, may have Drug Facts panel.
2. Extract the drug name (brand name) and generic name if both are shown.
3. Extract the strength (e.g., "500 mg", "10 mg/mL") and dosage form (tablet, capsule, liquid, cream, etc.).
4. Extract the manufacturer if shown.
5. Extract identifying codes: NDC (US) or DIN (Canada), lot number, expiration date.
6. Extract the full directions/sig text exactly as printed on the label.
7. Parse the directions to determine frequency if possible (e.g., "every 8 hours").
8. Extract ALL warning text — this includes:
   - Main warnings printed on the label.
   - Auxiliary/sticker warnings (colored stickers on prescription bottles).
   - For OTC: the entire Warnings section from the Drug Facts panel.
9. Extract storage instructions (e.g., "Store at room temperature", "Refrigerate").
10. Extract pharmacy information (name, address, phone) if this is a prescription label.
11. Extract the prescriber name if shown.
12. Extract the patient name, fill date, Rx number, and refills remaining.

Pay special attention to small print on auxiliary warning labels — these are often on colored stickers and contain important safety information.

Return ONLY valid JSON matching the medication_label schema. Use null for any field not found in the document.
```

## Edge Cases

- **Curved/wrapped labels**: Labels on round bottles curve around the surface. Photos may show only part of the label, or text may be distorted by curvature. Extract what is visible and note missing sections.
- **Auxiliary warning stickers**: These small colored stickers (e.g., orange "May cause drowsiness", yellow "Take with food") are critical safety information. They may be partially peeled off, overlapped by other stickers, or placed on the back of the bottle.
- **Multiple labels layered**: Pharmacists sometimes place new labels over old ones during refills. The visible label is the current one — ignore any partially visible older labels underneath.
- **Blister pack labels**: Some medications come in blister packs with minimal labeling. Extract whatever information is available.
- **Compounded medications**: Pharmacy-compounded medications may have handwritten labels or less standardized formatting. Extract all text as-is.
- **Faded thermal labels**: Pharmacy labels printed on thermal paper fade over time. Text may be barely visible. Mark illegible sections with `[ILLEGIBLE]`.
- **Drug Facts panel (OTC)**: OTC medications have a structured Drug Facts panel with sections: Active ingredient, Uses, Warnings, Directions, Other information, Inactive ingredients. Parse each section separately.
- **Small vial labels**: Vial labels (injectables, eye drops) are very small and may have extremely tiny text. Extract what is legible and note if text is too small to read.
- **Non-English labels**: Some medications may have bilingual labels (English/Spanish in the US, English/French in Canada). Extract the English text primarily; note if only non-English text is available.
- **Partial label visibility**: If only part of the label is visible in the image, extract what is available and set missing fields to null.
