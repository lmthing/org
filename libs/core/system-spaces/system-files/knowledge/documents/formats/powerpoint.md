---
description: PowerPoint decks (.pptx) — slide text and speaker notes ordering.
---

# PowerPoint (`pptx`)

Extracted with **officeparser**. `doc.text` is the text of every slide in slide order —
titles, bullet points, and text boxes — plus **speaker notes**.

What to expect and watch for:

- Content flows **slide by slide** but there are no explicit `Slide N` markers; a burst
  of short lines (a title followed by bullets) usually marks a new slide. Infer slide
  boundaries from the rhythm of the text rather than trusting a delimiter.
- **Speaker notes** are included (by default right after each slide's content). They are
  the presenter's script, not what the audience saw — distinguish them when it matters.
- Bullet nesting/indentation is flattened; sub-bullets read as ordinary lines.
- Charts, SmartArt, images, and tables are largely lost — only their raw text (labels,
  cell text) may survive, without structure.
- When summarising, describe the deck's arc (how many topics/sections it seems to cover)
  rather than claiming an exact slide count, which you can't reliably recover.
- **Legacy `.ppt`** (old binary PowerPoint) is not supported — a failed read means ask
  the user to re-save as `.pptx`.
