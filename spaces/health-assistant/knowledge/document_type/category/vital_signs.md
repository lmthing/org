---
title: Vital Signs
description: Vital sign measurements — blood pressure, heart rate, temperature, respiratory rate, SpO2, weight, height, and BMI
order: 11
---

# Vital Signs

## Required Fields

Every vital signs extraction must return the following structured fields:

```json
{
  "documentType": "vital_signs",
  "patientName": "string | null",
  "patientDateOfBirth": "YYYY-MM-DD | null",
  "patientId": "string | null",
  "recordDate": "YYYY-MM-DD | null",
  "recordTime": "HH:MM | null",
  "recordSource": "clinical_visit | home_monitoring | emr_printout | wearable | triage | anesthesia_record | other | null",
  "provider": "string | null",
  "facility": "string | null",
  "vitals": {
    "bloodPressure": {
      "systolic": "number | null — in mmHg",
      "diastolic": "number | null — in mmHg",
      "position": "sitting | standing | supine | null",
      "arm": "left | right | null",
      "cuffSize": "standard | large | thigh | pediatric | null"
    },
    "heartRate": {
      "value": "number | null — in bpm",
      "rhythm": "regular | irregular | null",
      "method": "palpation | auscultation | pulse_ox | ecg | null"
    },
    "temperature": {
      "value": "number | null",
      "unit": "F | C",
      "route": "oral | tympanic | temporal | axillary | rectal | core | null"
    },
    "respiratoryRate": {
      "value": "number | null — in breaths per minute"
    },
    "oxygenSaturation": {
      "value": "number | null — in percent",
      "method": "pulse_ox | abg | null",
      "onRoomAir": "boolean | null",
      "oxygenFlowRate": "string | null — e.g., '2 L/min via nasal cannula'"
    },
    "weight": {
      "value": "number | null",
      "unit": "kg | lbs",
      "method": "standing_scale | bed_scale | chair_scale | estimated | null"
    },
    "height": {
      "value": "number | null",
      "unit": "cm | in"
    },
    "bmi": {
      "value": "number | null",
      "percentile": "number | null — for pediatric patients",
      "category": "underweight | normal | overweight | obese | null"
    },
    "pain": {
      "value": "number | null — 0-10 scale",
      "location": "string | null",
      "character": "string | null"
    },
    "bloodGlucose": {
      "value": "number | null — in mg/dL or mmol/L",
      "unit": "mg/dL | mmol/L",
      "fasting": "boolean | null",
      "timeSinceMeal": "string | null"
    }
  },
  "trends": [
    {
      "date": "YYYY-MM-DD | null",
      "bloodPressure": "string | null",
      "heartRate": "number | null",
      "weight": "number | null",
      "bloodGlucose": "number | null"
    }
  ],
  "summary": "string — brief plain-language summary of notable vital sign findings"
}
```

## Common Terminology

| Term | Meaning |
|------|---------|
| BP | Blood Pressure — systolic/diastolic in mmHg |
| HR / Pulse | Heart Rate — beats per minute |
| Temp | Temperature — in Fahrenheit or Celsius |
| RR | Respiratory Rate — breaths per minute |
| SpO2 / O2 Sat | Oxygen Saturation — percentage of hemoglobin bound to oxygen |
| BMI | Body Mass Index — weight(kg) / height(m)^2 |
| VS | Vital Signs — the collective set of measurements |
| Orthostatic | Blood pressure and heart rate measured in multiple positions (lying, sitting, standing) |
| MAP | Mean Arterial Pressure — estimated as diastolic + 1/3(systolic - diastolic) |
| Pulse pressure | Systolic minus diastolic — wide (>40) may indicate aortic regurgitation; narrow (<25) may indicate heart failure |
| NC | Nasal Cannula — low-flow oxygen delivery device |
| RA | Room Air — no supplemental oxygen |
| NPO | Nothing by mouth — fasting status |
| BMI categories | Underweight (<18.5), Normal (18.5-24.9), Overweight (25-29.9), Obese (30+) |
| Pediatric vitals | Normal ranges vary by age; heart rate and respiratory rate are higher in children |
| Triage vitals | Initial vital signs taken at emergency/urgent care intake |

## Extraction Prompt Template

```
You are a medical document extraction agent specializing in vital sign measurements.

Analyze the provided document image and extract ALL vital sign data into structured JSON.

Instructions:
1. Identify the patient, date, time, and source of the vital signs.
2. For BLOOD PRESSURE:
   - Extract systolic and diastolic as separate numeric values (e.g., "120/80" → systolic: 120, diastolic: 80).
   - Note the position (sitting/standing/supine) and arm (left/right) if documented.
   - If orthostatic vitals are shown (multiple positions), extract each set separately and note the position.
3. For HEART RATE:
   - Extract the numeric value in bpm.
   - Note the rhythm (regular/irregular) if documented.
   - Note the measurement method if specified.
4. For TEMPERATURE:
   - Extract the numeric value and unit (F or C).
   - Note the route (oral, tympanic, temporal, axillary, rectal) if specified.
   - If only one unit is shown, do not convert — extract as-is.
5. For RESPIRATORY RATE:
   - Extract the numeric value in breaths per minute.
6. For OXYGEN SATURATION (SpO2):
   - Extract the percentage value.
   - Note if on room air or supplemental oxygen.
   - If on oxygen, extract the flow rate and delivery method (e.g., "2 L/min via NC").
7. For WEIGHT:
   - Extract the numeric value and unit (kg or lbs).
   - Do not convert between units — extract as documented.
8. For HEIGHT:
   - Extract the numeric value and unit (cm or inches).
   - Some records use feet+inches (e.g., "5'10\""). Convert to total inches (70 in) for the value field.
9. For BMI:
   - Extract if documented. If not, it will be calculated downstream.
   - For pediatric patients, extract BMI percentile if shown.
   - Classify: <18.5 = underweight, 18.5-24.9 = normal, 25-29.9 = overweight, 30+ = obese.
10. For PAIN:
    - Extract the numeric score (0-10 scale).
    - Note the location and character if documented.
11. For BLOOD GLUCOSE (if shown):
    - Extract the value and unit (mg/dL or mmol/L).
    - Note fasting status.
12. If a trend table is shown with historical values, extract each row as a trend entry.

Return ONLY valid JSON matching the vital_signs schema. Use null for any field not found in the document.
```

## Edge Cases

- **Orthostatic vital signs**: When BP and HR are measured in multiple positions (supine, sitting, standing), each position may show different values. Extract all sets with their position noted.
- **Abnormal values requiring flags**: Some vitals need immediate attention:
  - BP > 180/120 or < 90/60
  - HR > 120 or < 50
  - SpO2 < 90%
  - Temp > 103F (39.4C) or < 96F (35.5C)
  - RR > 24 or < 10
  - Include a note in the summary if any critical values are present.
- **Home monitoring printouts**: Patients using home BP monitors or glucose meters may bring printouts with many readings over days/weeks. Extract the most recent reading primarily, but capture the trend if feasible.
- **Wearable device data**: Smart watch or fitness tracker screenshots may show HR, SpO2, and activity data. Extract what is available.
- **Anesthesia records**: Intraoperative vital signs are recorded every 5 minutes and may fill an entire page. Extract the key values (pre-induction, intra-op range, and final values).
- **Pediatric normal ranges**: Heart rate and respiratory rate normal ranges vary significantly by age in children. Extract the values as documented — do not flag as abnormal based on adult ranges.
- **Mixed units**: Some records use metric, others imperial. Weight in kg vs lbs, height in cm vs inches, temp in C vs F. Never convert — extract as documented.
- **Handwritten vitals**: Paper triage forms and nursing notes often have handwritten vitals. Mark illegible values with `[ILLEGIBLE]`.
- **Missing fields**: Not every vital sign is measured at every encounter. A routine office visit may record BP, HR, temp, and weight but not respiratory rate or SpO2. Set missing values to null.
- **Pain scale variations**: Most use the 0-10 Numeric Rating Scale, but some use faces scales (pediatric) or verbal descriptors. Extract the numeric equivalent if possible.
