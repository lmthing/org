---
title: Allergy Record
description: Allergy documentation — allergen, reaction type, severity, date identified, and verification status
order: 7
---

# Allergy Record

## Required Fields

Every allergy record extraction must return the following structured fields:

```json
{
  "documentType": "allergy",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "allergies": [
    {
      "allergen": "string",
      "category": "drug | food | environmental | latex | contrast | other",
      "reactionType": "string | null — anaphylaxis | rash | hives | angioedema | itching | GI | respiratory | other",
      "severity": "mild | moderate | severe | life_threatening | unknown",
      "dateIdentified": "YYYY-MM-DD | null",
      "dateOfReaction": "YYYY-MM-DD | null",
      "verification": "confirmed | suspected | unconfirmed | refuted | null",
      "source": "patient_report | clinical_observation | skin_test | blood_test | challenge_test | null",
      "notes": "string | null",
      "relatedMedications": ["string | null"]
    }
  ],
  "noKnownAllergies": "boolean — true if document explicitly states NKDA/NKA",
  "summary": "string — brief plain-language summary of allergy profile"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| NKDA | No Known Drug Allergies |
| NKA | No Known Allergies (any type) |
| Anaphylaxis | Severe, potentially life-threatening allergic reaction involving multiple organ systems |
| Angioedema | Deep tissue swelling, often face/throat — can compromise airway |
| Urticaria / Hives | Raised, itchy welts on the skin |
| IgE-mediated | True allergic reaction involving immunoglobulin E antibodies |
| Type IV hypersensitivity | Delayed hypersensitivity (e.g., contact dermatitis) |
| Sensitivity | Adverse reaction that is not a true allergy (e.g., lactose intolerance) |
| Intolerance | Non-immune adverse reaction (e.g., GI upset from antibiotics) |
| Cross-reactivity | Allergen shares proteins with another substance, causing similar reactions |
| Desensitization | Gradual exposure protocol to reduce allergic response |
| Skin prick test | Diagnostic test placing small amounts of allergen on/under skin |
| RAST / ImmunoCAP | Blood tests measuring specific IgE antibodies |
| Challenge test | Supervised exposure to confirm or rule out allergy |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in allergy documentation.

Analyze the provided document image and extract ALL allergy information into structured JSON.

Instructions:
1. Identify the patient (name, date of birth).
2. If the document explicitly states "No Known Allergies" (NKA) or "No Known Drug Allergies" (NKDA), set "noKnownAllergies" to true and leave the allergies array empty.
3. For EACH allergy entry:
   - Extract the allergen name exactly as documented (e.g., "Penicillin", "Peanuts", "Latex", "Shellfish", "Pollen").
   - Classify the allergen category:
     * "drug" for medications (including specific drug classes like "PCN" for penicillins).
     * "food" for food allergies.
     * "environmental" for pollen, dust mites, pet dander, mold.
     * "latex" for latex rubber allergy.
     * "contrast" for imaging contrast dye allergy.
     * "other" for anything else (e.g., adhesive, nickel).
   - Extract the reaction type(s) — a single allergy may have multiple reactions. Use the most severe reaction documented:
     * "anaphylaxis" — if documented as anaphylactic shock, anaphylaxis, or describes airway compromise + hypotension.
     * "rash" — generalized skin eruption.
     * "hives" / "urticaria" — raised itchy welts.
     * "angioedema" — swelling of face, lips, tongue, throat.
     * "itching" / "pruritus" — without visible rash.
     * "GI" — nausea, vomiting, diarrhea, abdominal pain.
     * "respiratory" — wheezing, shortness of breath, bronchospasm.
   - Determine severity:
     * "mild" — local reaction, minor itching, mild rash.
     * "moderate" — widespread rash, significant discomfort, requires antihistamine.
     * "severe" — requires emergency treatment, epinephrine, ER visit.
     * "life_threatening" — anaphylaxis, airway compromise, ICU admission.
   - Extract the date the allergy was identified or the date of the reaction.
   - Note the verification status: confirmed (tested), suspected, unconfirmed, or refuted.
   - Note the source: patient self-report, clinical observation during administration, skin test, blood test (RAST/ImmunoCAP), or challenge test.
   - For drug allergies, list related medications in the same class (e.g., if allergic to penicillin, note amoxicillin, ampicillin as related).

Return ONLY valid JSON matching the allergy schema. Use null for any field not found in the document.
```

## Edge Cases

- **Allergy list in EHR**: Many documents are a printed allergy list from an EHR. These are typically tabular with columns for allergen, reaction, severity, and date. Extract each row as a separate allergy entry.
- **"NKDA" with additional entries**: Some patients have NKDA for drugs but list food or environmental allergies. Do not set `noKnownAllergies` to true in this case.
- **Patient-reported vs. confirmed**: Many allergy lists are based on patient self-report and have never been formally tested. Distinguish between verified (tested) and patient-reported allergies.
- **Vague descriptions**: Patients may report "I had a reaction to [drug]" without specifying the type. Set `reactionType` to null and note `"reaction not specified"` in notes.
- **Cross-reactivity**: Patients allergic to one NSAID may react to others. If a drug class allergy is noted (e.g., "NSAIDs", "sulfonamides"), list it as the allergen with related medications enumerated.
- **Childhood allergies that resolved**: Some allergies (milk, egg) are commonly outgrown. If the document notes "resolved" or "outgrown," set `verification` to "refuted" and note the resolution.
- **Sensitivity vs. allergy**: Some entries are "intolerances" rather than true allergies (e.g., "codeine — nausea"). Note this distinction in the severity or notes field.
- **Scanned/handwritten allergy cards**: Some patients carry handwritten allergy alert cards. Extract all text, noting that handwriting may be difficult to read.
- **Multi-page allergy workup**: A full allergy workup (skin testing, blood tests) may span multiple pages. Merge all findings into the allergies array.
- **Contrast dye allergies**: These are critical for imaging safety. Always capture these even if they appear in a different section of the document.
