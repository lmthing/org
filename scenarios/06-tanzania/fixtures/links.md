# Links & provenance — 06-tanzania fixtures

Real, currently-reachable sources a research step for this trip would legitimately fetch.
Every URL below was checked with `curl -s -o /dev/null -w '%{http_code}'` on 2026-07-13 and
returned **200**.

1. **Ngorongoro Conservation Area Authority — tariffs page**
   https://www.ncaa.go.tz/tariffs/
   Official NCAA fee page for the Ngorongoro Crater leg of the safari (Aug 7–9). Links to the
   tariff PDF used as fixture #2 below.

2. **NCAA Tariffs PDF (direct download)**
   https://www.ncaa.go.tz/wp-content/uploads/2026/06/NCAA-TARRIFS-v.2-Digital.pdf
   The exact PDF saved as `ngorongoro-conservation-area-tariffs.pdf` in this directory.

3. **Tanzania Immigration Department — visa fees**
   https://www.immigration.go.tz/index.php/fees/visa-fees
   Confirms the $50/person ordinary e-visa fee already noted in `tanzaniamemories.md`
   (`visa.immigration.go.tz` is the application portal; this is the fee schedule).

4. **Zanzibar mandatory travel insurance ($44) — Tanzania Bleu**
   https://www.tanzaniableu.com/posts/zanzibar-travel-insurance
   Background for the Zanzibar Insurance Corporation (ZIC) requirement mentioned in
   `tanzaniamemories.md`; gives the $44/person price used in `trip-costs.xlsx` and the
   92-day validity window (see unique tokens below).

5. **Wikimedia Commons — Stone Town, Zanzibar-3.jpg (file page)**
   https://commons.wikimedia.org/wiki/File:Stone_Town,_Zanzibar-3.jpg
   Source page for the photo saved as `stone-town-zanzibar.jpg` (CC BY 2.0, David Berkowitz;
   full-res original at
   `https://upload.wikimedia.org/wikipedia/commons/c/c8/Stone_Town%2C_Zanzibar-3.jpg`).

6. **Ayla Beach House, Kiwengwa, Zanzibar — rates**
   https://ayla-beach-house.zanzibarhotelstoday.com/en/
   Source for the ~$76/night rate used for the Aug 13–17 beach leg in `trip-costs.xlsx`.

## Fixture provenance (the rest)

- `stone-town-zanzibar.jpg` — downloaded from the Wikimedia Commons full-resolution URL in
  link #5 above. Real JPEG, ~1.9 MB, CC BY 2.0, photographer David Berkowitz.
- `ngorongoro-conservation-area-tariffs.pdf` — downloaded from link #2 above (NCAA official
  site). Real 4-page PDF, ~1.3 MB.
- `trip-costs.xlsx` — built locally with python3 + openpyxl; park-fee lines sourced from the
  NCAA PDF (link #2) plus web-searched Tarangire/Lake Manyara non-resident rates ($59/adult,
  peak season) and lodging nightly rates for each named property in `tanzaniamemories.md`
  (Eileen Hotel, Serengeti Villa, Kutoka Lodge, Treasures of Zanzibar House, Ayla Beach House,
  Sunny Shore B&B, Ramses Hilton); safari/dining/visa/permit figures copied from
  `tanzaniamemories.md` itself for consistency.
- `voice-memo.mp3` / `voice-memo.txt` — generated with Azure TTS (`tts` deployment, voice
  `alloy`) on the `lmthing-resource` Azure OpenAI resource, then round-tripped through the
  `whisper` deployment to produce the transcript saved in `voice-memo.txt` (see verification
  note below).

## Voice memo round-trip verification

Transcribed `voice-memo.mp3` back through
`.../deployments/whisper/audio/transcriptions?api-version=2024-06-01` (multipart
`file=@voice-memo.mp3`, `response_format=text`). The whisper transcript (saved verbatim to
`voice-memo.txt`, including its one transcription quirk — "Naurangoro" for "Ngorongoro") still
carries every fact unique to the memo: the guide's name **Emmanuel**, the bracelet price
("$25 ... or maybe it was $20"), the ~35,000 TZS cash payment, and the 5,000 TZS ranger tip at
the gate. None of those facts appear anywhere else in this fixture set — confirmed by `grep -r`
across `fixtures/` before writing this file.

## Unique tokens (one per fixture — an assertion can only use these)

| Fixture | Unique token | Why it's unique |
|---|---|---|
| `tanzaniamemories.md` | flight reference `ZZJQUU` (Aug 3 ATH→CAI, Aegean A3932) | booking reference code, not repeated in any other fixture |
| `stone-town-zanzibar.jpg` | EXIF camera model `Canon PowerShot SX30 IS` (embedded metadata, `strings`-visible) | the photo's own capture metadata — no other fixture mentions a camera model |
| `ngorongoro-conservation-area-tariffs.pdf` | NCAA contact line `Hotline: +255 27 253 7046` (Conservation Commissioner, P.O. Box 1 Ngorongoro Crater) | official NCAA phone number, distinct from every other contact number in the fixture set |
| `trip-costs.xlsx` | computed grand total `3344.2` (`TOTAL (usd, excl. flights which are in EUR)`, `costs` sheet) | a derived sum that exists only as a spreadsheet cell |
| `voice-memo.mp3` / `voice-memo.txt` | guide name **Emmanuel** and the 5,000-shilling ranger tip at the gate | invented in-scene detail from the day at the crater; not in the trip notes, the costs sheet, or the PDF |
| `links.md` (this file) | the Zanzibar insurance policy's **92-day validity window** (see link #4) | a detail from the sourced insurance article that isn't repeated in `trip-costs.xlsx` (which only carries the $44 price) or `tanzaniamemories.md` |
