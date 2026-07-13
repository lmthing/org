# Research links — life-admin household

Real, currently-reachable pages a research step on this household would legitimately fetch
(car-insurance renewal shopping, utility tariffs, the boiler's regulatory service cadence, an
appliance's official warranty terms). Each verified `HTTP 200` by `curl -sS -o /dev/null -w
"%{http_code}"` on 2026-07-13.

1. **https://powerprice.gr/electricity/tariffs/dei-g1g1n-oikiako** — 200. PPC (ΔΕΗ) Γ1/Γ1Ν
   residential electricity tariff, July 2026 pricing (€0.1384/kWh green band ≤200kWh) — what a
   "find me a cheaper electricity plan" research turn would open against the `bills` sheet's
   PPC rows.
2. **https://www.eydap.gr/CustomerSupport/normalrates/** — 200. EYDAP's official water/sewage
   tariff page (Athens water utility) — grounds the `bills` sheet's EYDAP row.
3. **https://www.energycost.gr/en** — 200. RAAEY's official electricity/gas price-comparison
   tool for Greek households — the actual "is there a cheaper option" comparison surface.
4. **https://www.bosch-thermotechnology.com/gr/el/homeowner/products-and-solutions/gas-condensing-boilers/condens-2200-i-w/** — 200.
   Bosch Greece's own product page for its Condens gas condensing combi boiler line — the
   manufacturer support page for the boiler family in `household-ledger.xlsx` / `boiler-service-manual.pdf`.
5. **https://www.dropfix.gr/syntiris-levita-aeriou-odigos/** — 200. Guide to Greece's mandatory
   annual gas-boiler/burner maintenance requirement (Law 3661/2008, ΚΕΝΑΚ) — the regulation behind
   why the household needs the annual visit described in `voice-memo.mp3`.
6. **https://www.bosch-home.co.uk/customer-service/warranty** — 200. Bosch's official appliance
   warranty page (2-year standard EU warranty) — grounds the `expires` column for the Bosch rows
   in `household-ledger.xlsx`'s `warranties` sheet.

## Provenance of every fixture in this directory

| Fixture | Source | Notes |
|---|---|---|
| `policies.md` | Authored for this scenario (not sourced from the web) | The household seed file; every insurer/policy-number token here is the scenario's ground truth. |
| `policy.pdf` | Pre-existing, source unknown | A genuine Greek motor-insurance policy contract (No. `2746423`/`10359487`, Suzuki Ignis, plate `ΙΥΤ1537`); real document, not narratively tied to Dimitris K. — used as multi-modal PDF texture. |
| `policy-photo.jpg` | Pre-existing, source unknown | A genuine plumbing-supplies retail receipt (ΥΔΡΟΕΜΠΟΡΙΚΗ Ε.Π.Ε., receipt No. `2273`, total `€29.33`, 06/07/2026); real photo, used as multi-modal image texture. |
| `product-photo.png` | Pre-existing — Skroutz.gr product listing (SteweHome ceramic vase, `STE-042455-P42455`); the exact live listing URL could not be re-located by search, so it is recorded as "Skroutz.gr, exact URL unconfirmed" rather than guessed | Real e-commerce screenshot, used as multi-modal image texture. |
| `household-ledger.xlsx` | Authored for this scenario; the PPC/EYDAP tariff figures and the Bosch/Samsung/LG 2-year EU warranty terms are grounded in links 1, 2 and 6 above | New: bills + warranties for the same household (Filolaou 41). |
| `voice-memo.mp3` / `voice-memo.txt` | Generated via Azure OpenAI `tts` (voice `alloy`), round-tripped through the `whisper` deployment for verification on 2026-07-13 | `voice-memo.txt` holds the actual Whisper transcript (not the authored script) — the next-service date and the meter reading both survived the round trip; the engineer's surname anglicized slightly (`Kostas`→`Costas`, `Attikis`→`Akis`) as expected of STT on a Greek proper noun. |
| `boiler-service-manual.pdf` | Downloaded from Bosch's own techdoc host (`bosch-au-en-techdoc.boschhc-documents.com`), doc `6 720 644 143 (2016/04)` | Genuine 22-page Bosch **Condens 5000 W** (`ZSB 30-2 A` / `ZWB 37-2 A`) installation & servicing manual — the same boiler family as the `Bosch Condens 5000 W (ZWB 30-2 A)` unit in `household-ledger.xlsx`. |
| `links.md` | This file | Authored for this scenario. |

## Unique tokens (one per fixture — an assertion can only use these)

- `policies.md` → **`AX-7741-VAULT`** (the car-insurance policy number; also `GR-VAULT-002`, `MetLife Silver`, `€642`, `2026-09-15` per the file's own header note)
- `policy.pdf` → **`2746423 / 10359487`** (the motor policy/renewal number pair; also plate `ΙΥΤ1537`)
- `policy-photo.jpg` → **`receipt No. 2273, €29.33`** (ΥΔΡΟΕΜΠΟΡΙΚΗ plumbing-supplies receipt, 06/07/2026)
- `product-photo.png` → **`STE-042455-P42455`** (the Skroutz SteweHome vase product code)
- `household-ledger.xlsx` → **`BLR-ZWB30-208841`** (the boiler's serial number, `warranties` sheet); also `WM-BSH-774120`, `SM-FR-902215`
- `voice-memo.mp3` / `voice-memo.txt` → **`Kostas Xenakis`, next service `15th of January 2027`, gas-meter reading `04821.6`** — none of these three appear in any other fixture
- `boiler-service-manual.pdf` → **`6 720 613 085-00.1O`** (the manual's own document number; also model codes `ZSB 30-2 A` / `ZWB 37-2 A`)
- `links.md` → this table itself (the provenance record) is the fixture's distinguishing content
