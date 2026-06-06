---
title: Vaccination Record
description: Immunization records — vaccine name, date, lot number, manufacturer, site, and next dose scheduling
order: 6
---

# Vaccination Record

## Required Fields

Every vaccination record extraction must return the following structured fields:

```json
{
  "documentType": "vaccination",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "vaccinations": [
    {
      "vaccineName": "string",
      "cvxCode": "string | null",
      "manufacturer": "string | null",
      "lotNumber": "string | null",
      "expirationDate": "YYYY-MM-DD | null",
      "administrationDate": "YYYY-MM-DD | null",
      "doseNumber": "number | null",
      "totalDosesInSeries": "number | null",
      "route": "IM | SC | ID | PO | IN | other | null",
      "site": "left deltoid | right deltoid | left thigh | right thigh | nasal | oral | other | null",
      "administeredBy": "string | null",
      "facility": "string | null",
      "visDate": "YYYY-MM-DD | null",
      "nextDoseDate": "YYYY-MM-DD | null",
      "seriesComplete": "boolean | null",
      "notes": "string | null"
    }
  ],
  "source": "string | null — cdc_record | state_registry | pharmacy | provider_office | school | other",
  "summary": "string — brief plain-language summary"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| CVX | CDC Vaccine Code — standardized numeric code for each vaccine type |
| VIS | Vaccine Information Statement — CDC document given to patient before vaccination |
| IM / SC / ID / PO / IN | Intramuscular / Subcutaneous / Intradermal / By mouth / Intranasal |
| Deltoid | Upper arm muscle — most common injection site for adults |
| Vastus lateralis | Outer thigh muscle — common injection site for infants |
| Series | Multi-dose vaccination schedule (e.g., HPV is 2–3 doses, Hep B is 3 doses) |
| Booster | Additional dose after the primary series to maintain immunity |
| Lot # | Manufacturing lot number for traceability in case of recalls |
| Contraindication | Reason a vaccine should NOT be given to this patient |
| Titer | Blood test measuring antibody levels to confirm immunity |
| Catch-up schedule | Accelerated schedule for patients who missed doses at the recommended age |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in vaccination and immunization records.

Analyze the provided document image and extract ALL vaccination entries into structured JSON.

Instructions:
1. Identify the patient (name, date of birth, patient ID).
2. For EACH vaccination entry on the document:
   - Extract the vaccine name exactly as printed (e.g., "COVID-19, mRNA, Bivalent", "Influenza, quadrivalent", "MMR", "DTaP").
   - Extract the CVX code if shown (a 2–3 digit number).
   - Extract the manufacturer (e.g., "Pfizer-BioNTech", "Moderna", "GlaxoSmithKline", "Merck").
   - Extract the lot number (may be alphanumeric, e.g., "EW0182", "039K21A").
   - Extract the vaccine expiration date if printed.
   - Extract the date the vaccine was administered.
   - Determine the dose number in the series (e.g., dose 1 of 3) and total doses expected.
   - Extract the route of administration:
     * "IM" for intramuscular
     * "SC" for subcutaneous
     * "ID" for intradermal
     * "PO" for oral
     * "IN" for intranasal
   - Extract the anatomical site:
     * "left deltoid" / "right deltoid" (arm)
     * "left thigh" / "right thigh"
     * "nasal" (for FluMist, etc.)
     * "oral" (for oral vaccines)
   - Extract the name or title of the person who administered the vaccine.
   - Extract the facility/clinic where it was given.
   - Extract the VIS date if shown (the edition date of the Vaccine Information Statement).
   - Determine if the next dose date is specified or if the series is complete.
3. Identify the source of the record (CDC record, state immunization registry, pharmacy, provider office, school form, etc.).

Return ONLY valid JSON matching the vaccination schema. Use null for any field not found in the document.
```

## Edge Cases

- **CDC immunization cards**: The standard white CDC COVID-19 vaccination cards have handwritten entries. Handwriting quality varies enormously. Mark illegible fields with `[ILLEGIBLE]`.
- **State registry printouts**: These are typically structured tables with many rows. Ensure every row is captured as a separate vaccination entry.
- **School immunization forms**: These list required vaccines and may show dates or "waived"/"exempt" status. Note any exemptions.
- **International records**: Vaccines from other countries may use different names (e.g., "BCG" is common outside the US but rare within it). Some countries use different vaccine schedules. Extract names as-is.
- **Abbreviated vaccine names**: "DTaP", "Tdap", "MMR", "HepB", "IPV", "PCV13", "Hib", "Varicella", "HPV" — these are standard abbreviations. Do not expand them.
- **Combination vaccines**: "Pediarix" (DTaP+HepB+IPV), "Pentacel" (DTaP+IPV+Hib), "Kinrix" (DTaP+IPV). Extract the brand name and note the components.
- **Missing dates**: Some records show year only (no month/day). Use "YYYY-01-01" and note `[YEAR ONLY]` in comments.
- **Lot numbers for recalls**: Lot numbers are critical for vaccine safety. If partially legible, include what is readable and note `[PARTIAL]`.
- **Historical records**: Older records (childhood vaccines) may be on faded or damaged paper. Extract what is legible.
- **Multiple vaccines same date**: Patients often receive multiple vaccines at one visit (especially children). Each is a separate entry even if on the same date.
