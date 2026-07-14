# Research links (verified reachable — `curl` returned HTTP 200 on 2026-07-13)

These are the kind of pages a `system-research/researcher` delegation would legitimately
fetch while helping Elena with this trip — visa rules, a bus operator, a price source, a park
permit page.

1. **Colombia — visa-free entry / Check-Mig** (US Embassy Bogotá)
   https://co.usembassy.gov/visas/
2. **Brazil — new mandatory e-visa (2026)** (US Embassy Brasília)
   https://br.usembassy.gov/visas/
3. **Bolivia — La Paz ↔ Uyuni tourist bus operator** (Todo Turismo, official site)
   https://todoturismo.bo/en/page-inicial-en-eng/
4. **Chile — Torres del Paine national park entrance fees**
   https://torresdelpaine.com/en/torres-del-paine-2/useful-tips/entrance-fees/
5. **Peru — official Machu Picchu / protected-areas ticket portal** (Ministerio de Cultura)
   https://tuboleto.cultura.pe
6. **Colombia — Cartagena hostel/dorm price source**
   https://www.hostelworld.com/hostels/south-america/colombia/cartagena/

Verified with:
```
curl -s -o /dev/null -w "%{http_code}" -A "Mozilla/5.0" -L <url>   # all returned 200
```

---

## Provenance — where every other fixture in this directory came from

- **`trip-notes.md`** — Elena's own notes (authored for this fixture set), but every checkable
  fact in it is grounded in real research done for this task:
  - ADO Mexico City→Oaxaca bus classes/prices (regular/GL/Platino, TAPO terminal, ~6–7h):
    https://www.busbud.com/en/bus-mexico-city-oaxaca/r/9g3w81-9g51p1 ,
    https://www.mexicotravelandleisure.com/blog/mexico-city-to-oaxaca/
  - LATAM flight **LA2232** Lima (LIM) → Cusco (CUZ), 08:45 departure:
    https://www.flightconnections.com/flights-from-lim-to-cuz
  - Avianca flight **AV9788** Bogotá (BOG) → Cartagena (CTG): confirmed via Avianca flight-status
    aggregators (airportia.com / flight.info) while researching this trip
  - Colombia 90-day visa-free entry + Check-Mig requirement: https://co.usembassy.gov/visas/
  - Brazil's new mandatory e-visa starting Jan 1 2026 (US/Canada/Australia/Mexico/France/
    Argentina nationals, ~US$80.90, VFS portal): https://www.visahq.com/brazil/
  - Wild Rover La Paz hostel (real hostel chain, Calle Comercio, La Paz):
    https://wildroverhostels.com/hostels/la-paz/

- **`salar-de-uyuni-bolivia-2016-02-04.jpg`** — downloaded from Wikimedia Commons, freely
  licensed (CC BY-SA 4.0), original capture date 2016-02-04:
  https://commons.wikimedia.org/wiki/File:Salar_de_Uyuni,_Bolivia,_2016-02-04,_DD_16-18_HDR.JPG

- **`peru-machu-picchu-tarifas-2026-resolucion-284-2025-MC.pdf`** — the actual official PDF,
  downloaded directly from Peru's Ministerio de Cultura transparency portal:
  https://transparencia.cultura.gob.pe/sites/default/files/transparencia/2025/10/resoluciones-ministeriales/resolucionministerial-000284-2025-mcyanexo.pdf
  (Resolución Ministerial N° 000284-2025-MC, signed 30 Oct 2025 — promotional 2026 tariffs for
  national/resident/Andean-Community visitors to the Llaqta de Machupicchu; NOTE: these
  promotional soles rates do NOT apply to a foreign non-resident tourist like Elena, whose
  standard adult foreign-tourist rate is a separate ~S/152 (~US$40), rising to ~S/163 after
  1 May 2026 — see https://tuboleto.cultura.pe)

- **`trip-budget.xlsx`** — built with `openpyxl`; every cost line is grounded in the same
  research pass:
  - Machu Picchu foreign-adult entrance ticket (~US$40 standard circuit): https://tuboleto.cultura.pe
  - Todo Turismo La Paz→Uyuni overnight bus (~US$43 one-way): https://todoturismo.bo/en/page-inicial-en-eng/
  - Torres del Paine high-season foreign entrance fee (~US$35): https://torresdelpaine.com/en/torres-del-paine-2/useful-tips/entrance-fees/
  - Cartagena old-town hostel dorm price range (~US$18–25/night): https://www.hostelworld.com/hostels/south-america/colombia/cartagena/
  - Brazil e-visa fee (~US$80.90): https://www.visahq.com/brazil/
  - ADO bus fares, LA2232 / AV9788 flights: same sources as `trip-notes.md` above

- **`camila-whatsapp-uyuni.png`** (added round 2) — a phone screenshot of Camila's WhatsApp
  messages, rendered for this fixture set (PIL, `/tmp/mk-screenshot.py`) in the same spirit as
  `trip-notes.md` and `voice-memo.mp3`: **authored, but every checkable fact is grounded in real
  research.** Its load-bearing fact is a REAL Uyuni tour operator —
  **Red Planet Expedition** (TripAdvisor `d1940181`, Uyuni, Potosí Department):
  https://www.tripadvisor.com/Attraction_Review-g317033-d1940181-Reviews-Red_Planet_Expedition_Day_Trip-Uyuni_Potosi_Department.html
  — including the detail reviewers repeatedly single out (the only operator with night access to
  the hot springs) and a realistic 3-day price in bolivianos.

  **Why it is a genuinely different KIND of fixture.** The scenario's persona always promised "one
  screenshot a friend sent her", and the fixture set never had one. The only other image
  (`salar-de-uyuni…jpg`) carries **no extractable text**, and its token (`2016-02-04`) lives in the
  *filename* — so nothing in 05-latam ever proved the **pixels** were read. Here the fact exists
  ONLY as pixels:
  - `strings camila-whatsapp-uyuni.png | grep -i "red planet"` → **no match** (a guessing model
    cannot get it from the bytes, and neither can `grep`);
  - **vision round-trip verified** (the same protocol the TTS memo used) — the image was sent to
    the `gpt-5.4-mini` vision deployment on `$AZURE_RESOURCE_NAME`, which read back: *"She says to
    book **Red Planet Expedition**, and it costs **1100 Bs per person** for a **3-day tour**"*.
  - It is also the fixture that makes Act XIV honest: `readDocument` **legitimately fails** on a
    PNG, so the trace can prove the wrong-tool-for-the-media-type degraded into vision rather than
    dying.

- **`voice-memo.mp3` + `voice-memo.txt`** — generated with Azure OpenAI TTS
  (`https://lmthing-resource.openai.azure.com/openai/deployments/tts/audio/speech`, voice
  `alloy`) from a Spanish script written for this fixture, and round-trip-verified by
  transcribing the produced MP3 back through the Whisper deployment on the same resource
  (`.../deployments/whisper/audio/transcriptions`). The script's one real-world anchor — the
  Cerro Churuquella viewpoint above Sucre — is grounded here:
  https://sucre.bo/las-12-estaciones-del-cerro-churuquella/ ,
  https://correodelsur.com/local/20250806/el-monumento-al-sagrado-corazon-en-el-cerro-churuquella-cumple-100-anos.html

---

## Unique tokens (one per fixture — an assertion can only use these)

Verified disjoint by grepping the content of every fixture in this directory (`grep -rn` for
text files; `pdftotext`/`unzip -p`/`strings` extraction for the PDF, xlsx, and binary media;
`find`/`ls` for the two binary files whose distinguishing token lives in the filename, since
they carry no extractable text of their own). Each token below was found in exactly the one
fixture listed, and in no other fixture file in this directory (this `links.md` file itself is
excluded from the disjointness check — its entire job is to catalogue all of them).

| Fixture | Unique token |
|---|---|
| `trip-notes.md` | `Wild Rover` (Camila's hostel tip for La Paz) |
| `salar-de-uyuni-bolivia-2016-02-04.jpg` | `2016-02-04` (the photo's original capture date, in the filename — the source JPEG carries no extractable EXIF text after resizing, so this is the file's disjoint anchor) |
| `peru-machu-picchu-tarifas-2026-resolucion-284-2025-MC.pdf` | `Huchuypicchu` (Ruta 3-D in the annex — a real, obscure Machu Picchu circuit name) |
| `trip-budget.xlsx` | `Torres del Paine` (the Chile park-fee line item) |
| `voice-memo.mp3` / `voice-memo.txt` | `Churuquella` (the Sucre viewpoint she mentions in the recording) |
| `camila-whatsapp-uyuni.png` | `Red Planet Expedition` (the real Uyuni operator Camila tells her to pre-book — **pixels only**: `strings` on the PNG does not contain it, and no other fixture mentions it) |
