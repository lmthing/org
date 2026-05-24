---
title: Referral
description: Specialist referrals — referring and referral provider, reason, urgency, and clinical context
order: 10
---

# Referral

## Required Fields

Every referral extraction must return the following structured fields:

```json
{
  "documentType": "referral",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "referralDate": "YYYY-MM-DD | null",
  "referringProvider": {
    "name": "string | null",
    "npi": "string | null",
    "specialty": "string | null",
    "facility": "string | null",
    "phone": "string | null"
  },
  "referralProvider": {
    "name": "string | null",
    "npi": "string | null",
    "specialty": "string | null",
    "facility": "string | null",
    "phone": "string | null"
  },
  "reason": "string — the clinical reason for the referral",
  "urgency": "routine | urgent | emergent | null",
  "diagnoses": [
    {
      "description": "string",
      "icd10Code": "string | null"
    }
  ],
  "clinicalSummary": "string | null — relevant clinical history provided with the referral",
  "currentMedications": ["string | null"],
  "allergies": ["string | null"],
  "relevantResults": [
    {
      "testName": "string | null",
      "date": "YYYY-MM-DD | null",
      "result": "string | null"
    }
  ],
  "specificQuestions": ["string | null — specific questions for the specialist"],
  "authorizationRequired": "boolean | null",
  "authorizationNumber": "string | null",
  "numberOfVisits": "number | null",
  "expirationDate": "YYYY-MM-DD | null",
  "summary": "string — brief plain-language summary"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| PCP | Primary Care Physician — often the referring provider |
| Referral | Authorization and clinical handoff to a specialist |
| Prior auth / Authorization | Insurance approval required before the specialist visit |
| NPI | National Provider Identifier |
| Urgency classification | Routine (weeks), Urgent (days), Emergent (immediate) |
| Clinical question | The specific question the referring provider wants answered |
| Transfer of care | Temporary vs. permanent handoff of a condition to the specialist |
| Consultation | Specialist provides opinion but care returns to referring provider |
| Co-management | Both PCP and specialist share ongoing management |
| Referral expiration | Date by which the patient must see the specialist |
| Number of visits | How many specialist visits are authorized |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in medical referral documents.

Analyze the provided document image and extract the referral into structured JSON.

Instructions:
1. Extract patient demographics (name, DOB, patient ID).
2. Extract the referral date (date the referral was created).
3. Extract the referring provider information:
   - Name, NPI, specialty, facility, and phone number.
4. Extract the referral (specialist) provider information:
   - Name (if specific provider named), specialty, facility, and phone number.
   - If no specific provider is named but a specialty is indicated (e.g., "Cardiology"), put the specialty in the specialty field.
5. Extract the reason for referral — this is the most important clinical field. Capture it verbatim.
6. Determine the urgency:
   - "routine" if no urgency specified, or stated as "routine", "non-urgent", "elective".
   - "urgent" if stated as "urgent", "ASAP", "soon", or within 1–2 weeks.
   - "emergent" if stated as "emergent", "STAT", "immediate", or within 24–48 hours.
7. Extract all diagnoses listed with ICD-10 codes if available.
8. Extract any clinical summary or history provided with the referral.
9. Extract the current medication list if included.
10. Extract the allergy list if included.
11. Extract any relevant test/lab/imaging results referenced in the referral.
12. Extract specific clinical questions the referring provider wants the specialist to address.
13. Determine if insurance authorization is required and extract the authorization number if shown.
14. Extract the number of authorized visits and the referral expiration date.

Return ONLY valid JSON matching the referral schema. Use null for any field not found in the document.
```

## Edge Cases

- **Open referrals**: Some referrals are to a specialty department rather than a specific provider (e.g., "Refer to Dermatology"). The referral provider name will be null but specialty will be populated.
- **Insurance referral forms**: Many referrals are standardized insurance forms with checkboxes and fill-in fields. Extract all populated fields.
- **Urgency not specified**: If urgency is not explicitly stated, infer it from the clinical context:
  - Chest pain, stroke symptoms, suspected cancer → "urgent" or "emergent"
  - Annual screening, stable chronic condition → "routine"
- **Handwritten referrals**: Some PCPs still use handwritten referral pads. Mark illegible sections with `[ILLEGIBLE]`.
- **Fax cover sheets**: Referrals are often faxed and the fax cover sheet may contain additional clinical information. Extract relevant clinical content from the cover sheet as well.
- **Multiple referrals on one page**: Occasionally a single document authorizes referrals to multiple specialists. If they share the same patient and date but different specialists, note this in the summary.
- **Standing referrals**: Some referrals authorize ongoing visits for chronic conditions (e.g., "12 physical therapy visits" or "quarterly endocrinology visits"). Extract the number of visits and time period.
- **Referral denial letters**: If the document is actually a denial of referral from insurance, note this and extract the denial reason.
- **E-referrals**: Electronic referral confirmations may have system-generated formatting, headers, and footers. Ignore non-clinical boilerplate.
- **Bilingual documents**: Referrals in multilingual areas may have content in two languages. Extract the primary language version.
