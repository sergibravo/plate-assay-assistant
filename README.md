# Plate Assay Assistant

Local-first calculator for plate-based cell-culture assays (reverse transfection +
compound dose-response). Replaces the `…hibit_transfection_optimisation…` and
`layout-aquous` workbooks with an auditable app.

**No server, no internet, no telemetry.** Everything computes in the browser; experiments
are saved as `.assay.json` files on your own disk.

## Run it

```bash
npm install     # once
npm run dev     # http://localhost:5173
```

## Send it to someone

```bash
npm run build
```

produces **one self-contained file** — `dist/Plate Assay Assistant <version>.html` (~1 MB).
Email it, drop it on a USB stick or a shared drive; the recipient double-clicks it and the
app opens in their browser. No install, no Node, no server, no internet: the script,
styles and the Excel library are all inlined, and the page makes zero network requests.

Their experiments stay on their machine — saved as `.assay.json` files wherever they choose.
The browser also autosaves the current experiment, though when the file is opened directly
from disk some browsers (Safari in particular) disable that storage; **Save project** always
works, so treat the JSON file as the real save.

To give the file a version bump before sending, change `version` in `package.json` and
rebuild — the version is part of the filename so two copies can be told apart.

## Printing a bench sheet

The **Print bench sheet** button on each module prints what is on screen, minus the controls.
Checked in **portrait** with the browser's **"scale to fit"** (or "fit to page width") — the
page sets portrait and margins itself, so that is the only setting to touch. Tables break
between rows rather than through them, and headers repeat on each page.

Run the calculation tests at any time:

```bash
npm test
```

## Layout

| Path | What it is |
| --- | --- |
| `src/calc/` | **All the science.** Pure functions, no UI, unit-tested. Audit this. |
| `src/calc/__tests__/` | Tests that reproduce the reference workbooks cell for cell. |
| `src/state/project.ts` | The project file model + save/open/autosave. |
| `src/export/` | Bench-sheet exports (Excel / print). |
| `src/ui/` | React screens. Yellow = user input, blue = auto-calculated. |
| `docs/formulas.md` | Every formula mapped back to its spreadsheet cell. |

## Modules

1. **Transfection calculator** — ✅ built (`Setup`, `PEI Mix`, `DNA Mixes` sheets).
   Cells are entered in **thousands (k) per well**; margin applies to the master mixes only;
   DNA stocks carry a lab ID; the condition grid grows, shrinks and may be ragged; OptiMEM
   per DNA tube is either a fixed volume added or a target final volume; the Excel bench
   sheet is colour-coded per condition.
2. **Plate layout** — ✅ built. Paint transfections and treatments onto a 96/384-well plate,
   drag to fill or erase, colours shared with module 3 and shading across a dilution series.
   The wells painted with a step tell module 3 how much of it to prepare.
3. **Serial dilutions + DMSO vehicle matching** — ✅ built, compounds only
   (`layout-aquous › Compounds`). Back-propagated prepared volumes, automatic DMSO matching
   across aqueous and DMSO stocks, per-compound and whole-experiment premix totals, and an
   assay-type selector (NanoBiT/BRET · HiBiT · DERET) that names the diluent and states what
   each assay still needs. Substrate preparation is included for BRET/NanoBiT and HiBiT, and
   DERET adds its fluorescein chain (100 mM → 1 mM → the working buffer) and the terbium
   labelling step. Everything is premixed from one batch of assay buffer.
4. **Plate-reader output reshaper** — stub only, by design.

## Later: sharing it beyond this lab

The app is a pure static bundle, so publishing it later means copying `dist/` to any
static host. If access needs to be gated by a key, note that a key checked in the browser
only deters casual access — it is not security. The honest options, cheapest first:
host-level HTTP basic auth or a private link, or (if real access control is ever needed)
a thin auth proxy in front of the static files. No assay data has to leave the machine
either way: the app never uploads anything.
