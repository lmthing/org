---
title: Prescription
description: Medication prescriptions — drug name, dosage, frequency, duration, prescriber, and refills
order: 2
---

# Prescription

## Required Fields

Every prescription extraction must return the following structured fields:

```json
{
  "documentType": "prescription",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "prescriptionDate": "YYYY-MM-DD | null",
  "prescriber": {
    "name": "string | null",
    "npi": "string | null",
    "facility": "string | null",
    "phone": "string | null",
    "dea": "string | null"
  },
  "medications": [
    {
      "drugName": "string",
      "genericName": "string | null",
      "strength": "string",
      "dosageForm": "string | null",
      "quantity": "string | null",
      "sig": "string — the full directions/signature line",
      "frequency": "string | null",
      "duration": "string | null",
      "refills": "number | null",
      "daysSupply": "number | null",
      "dAw": "boolean — dispense as written",
      "notes": "string | null"
    }
  ],
  "pharmacy": {
    "name": "string | null",
    "address": "string | null",
    "phone": "string | null",
    "ncpdp": "string | null"
  },
  "controlledSubstance": "boolean",
  "summary": "string — brief plain-language summary"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| Sig / Signature | Directions for use — the "take X by mouth Y times daily" instruction |
| DAW | Dispense As Written — no generic substitution allowed |
| PRN | As needed (pro re nata) |
| QD / QOD / BID / TID / QID | Once daily / Every other day / Twice daily / Three times daily / Four times daily |
| HS | At bedtime (hora somni) |
| AC / PC | Before meals / After meals |
| PO / SL / PR / SQ / IM / IV | By mouth / Sublingual / Rectal / Subcutaneous / Intramuscular / Intravenous |
| Tab / Cap / mL / mg / mcg | Tablet / Capsule / Milliliter / Milligram / Microgram |
| NPI | National Provider Identifier |
| DEA # | Drug Enforcement Administration registration number (required for controlled substances) |
| NCPDP | National Council for Prescription Drug Programs — pharmacy identifier |
| Refills | Number of additional fills authorized beyond the initial fill |
| Days supply | Total days the prescription quantity should last |
| Prior auth | Prior authorization required from insurance |
| Generic substitution | Whether a generic may be dispensed in place of brand name |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in prescription documents.

Analyze the provided document image and extract ALL prescription information into structured JSON.

Instructions:
1. Identify the patient (name, date of birth).
2. Identify the prescriber (name, NPI if shown, facility, phone, DEA number if shown).
3. For EACH medication prescribed:
   - Extract the drug name (brand or generic as printed).
   - If both brand and generic names appear, put the brand in "drugName" and generic in "genericName".
   - Extract the strength (e.g., "500 mg", "10/325 mg" for combination drugs).
   - Extract the dosage form (tablet, capsule, liquid, inhaler, cream, patch, etc.).
   - Extract the quantity prescribed (e.g., "30", "90 mL").
   - Extract the full sig/directions as a single string exactly as written.
   - Parse the sig into "frequency" (e.g., "twice daily") and "duration" (e.g., "14 days") if stated.
   - Extract the number of refills authorized. If "NR" or "0 refills", set to 0.
   - Extract the days supply if stated.
   - Determine if DAW is indicated (checkbox, circled, or "brand necessary").
   - Extract any additional notes or clinical instructions.
4. Identify the pharmacy if listed.
5. Determine if the medication is a controlled substance (Schedule II–V) based on:
   - Explicit schedule marking on the form.
   - DEA number presence.
   - Known controlled substance names (opioids, benzodiazepines, stimulants, etc.).

Return ONLY valid JSON matching the prescription schema. Use null for any field not found in the document.
```

## Edge Cases

- **Handwritten prescriptions**: Older or urgent prescriptions may be handwritten. Look for illegible sections and mark them with `[ILLEGIBLE]` in the relevant field.
- **Multiple medications on one prescription**: Some prescription pads allow 2–3 medications per page. Each must be a separate entry in the `medications` array.
- **Combination drugs**: Medications like "hydrocodone/acetaminophen 10/325 mg" have two active ingredients. Extract the full strength string as-is.
- **Sig ambiguity**: "Take 1-2 tabs Q4-6H PRN pain" has a range for both dose and frequency. Transcribe the full sig verbatim, then parse frequency as "every 4-6 hours as needed".
- **Refills as "PRN"**: Some prescriptions say "refills: PRN" meaning unlimited refills for a year. Set `"refills": 12` and `"comment": "PRN refills indicated"`.
- **Electronic prescriptions**: E-prescriptions may have a digital signature block, QR code, or barcode. These do not affect extraction but confirm authenticity.
- **Controlled substance forms**: Schedule II prescriptions (especially in the US) may use a special triplicate or tamper-resistant form. Look for watermarks, security features, or explicit "C-II" markings.
- **Abbreviated Latin**: Some prescribers still use Latin abbreviations (e.g., "i tab PO QD"). Convert the sig field verbatim, but include the parsed English meaning in `frequency`.
- **Partial/fax prescriptions**: Faxed prescriptions may be cut off at the edges. If critical fields are missing, set them to null and add a comment noting the truncation.
- **Verbal/telephone orders**: Rarely documented on a prescription form, but if you see "Verbal order" or "Telephone order" markings, note it in `notes`.
