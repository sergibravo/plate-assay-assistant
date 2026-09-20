# Decisions

Choices that shaped the app and would otherwise have to be re-argued from scratch. Newest
last. Formula-level provenance lives in [formulas.md](formulas.md).

## Platform

- **Local-first static web app** (React + TypeScript + Vite), no server, no network calls,
  no telemetry. Lab machines are often offline or locked down, and assay data stays on the
  machine. `npm run build` produces a folder that opens in any browser.
- **Later distribution to a wider community** is a copy of `dist/` to a static host. An
  access key checked in the browser deters casual access but is not security; real gating
  needs host-level auth or a thin proxy. Nothing in the app needs to change for either.
- **Tauri** stays an option for a double-clickable installer; nothing written so far blocks it.

## Structure

- **All calculations live in `src/calc/`** as pure functions with unit tests, so the science
  can be audited without reading UI code. Every formula is traced to its spreadsheet cell.
- **One project file** (`.assay.json`) holds an experiment; localStorage autosaves for
  convenience. Project files carry a version and are migrated on open (`migrate`), so model
  changes never orphan a saved experiment.

## Conventions the lab asked for

- **Yellow = user input, blue = auto-calculated**, carried over from the spreadsheets.
- **Units on every field**, and calculated volumes show "—" rather than a guessed number when
  a stock concentration is unknown.
- **Cells are counted in thousands (k), not millions.** The original sheet used M.
- **Margin means: excess for the shared master mixes** (PEI, its OptiMEM, and the cell
  suspension). It is never applied to per-condition DNA volumes.
- **DNA stocks carry a lab ID** ("ID", free text — pEK numbers in this lab).
- **Plate formats include half-area 96-well**, which shares the 8 × 12 footprint of a
  standard 96; only working volumes differ.
- **OptiMEM per DNA tube has two modes**: a fixed volume added (the sheet's behaviour), or a
  target final volume, where OptiMEM = target − DNA volume. User-selectable per experiment.
- **The condition grid is editable in both directions and may be ragged.** Columns and row
  groups are added and deleted individually; a block counts as a condition only once a % is
  typed in it. `Use` makes a filler-only control, `Clear` empties a block.
- **Excel exports are colour-coded per condition** and one point above Excel's default font
  size (read at arm's length in a hood). Written with `xlsx-js-style`, still fully offline.

## Hard-won implementation notes

- **Never use `window.confirm` / `alert`.** A native modal freezes the embedded preview
  browser, so the action silently never happens — this is what made column deletion look
  broken. Destructive actions use a two-step inline button (`ConfirmButton`): click to arm,
  click again within 6 s. Errors render as in-page banners.
- **`CEILING(x, 1)` snaps to a whole number within 1e-9 first.** Excel lets float noise turn
  a 200 µl tube into 201 µl; the app does not. Percentage sums are compared to 100 with the
  same tolerance.
- **Wide content scrolls inside its own container**, never pushing the panel out of the page.

## Version control and distribution

- **Git, from 2026-08-25.** The repository is the history of the calculations: it makes it
  possible to see what changed between two versions and to roll one back. The lab does not
  use git and does not have to — nobody receiving the app ever sees it.
- **The deliverable is a single HTML file**, not a folder. `npm run build` inlines script,
  styles and the Excel library into `dist/Plate Assay Assistant <version>.html`; a colleague
  double-clicks it and the app runs offline with no install. Consequences that shaped the
  build config: the bundle is an IIFE, not an ES module (module scripts are restricted when
  loaded from `file://`), and the inlined script is moved to the end of `<body>`, because a
  classic script is not deferred and would otherwise run before `#root` exists. Both are
  asserted in `scripts/name-build.mjs`, so a regression fails the build rather than shipping
  a blank page.
- A **Tauri installer** (a real `.app` / `.exe`, with an icon and no browser chrome) remains
  the upgrade path if the app is ever handed to clients who expect that; it needs a Rust
  toolchain and code signing, which the single file does not.
- **Reference workbooks live in `reference/`** rather than only on the Desktop, so the source
  of truth travels with the code. They are snapshots; originals stay where they were.

## Module 3 (2026-09-20)

- **Assay type is a first-class setting** (NanoBiT/BRET · HiBiT · DERET). It never changes a
  volume; it names the diluent and declares what that assay still needs. Built for
  NanoBiT/BRET first, compounds only. HiBiT shares the compound maths exactly, so its numbers
  are usable; DERET's are too, but its diluent must be the furimazine solution, which the app
  does not yet prepare. Both say so on screen and on the bench sheet rather than staying
  silent.
- **logM is the final in-well concentration**, not the tube concentration. Each tube is
  prepared at `dilutionFactor ×` that, matching the spreadsheet's `× f` on the top aliquot.
- **The in-well dilution factor is a separate setting** (default 2, the 50 µl + 50 µl
  addition) rather than being read from each block, because blocks can legitimately differ.
  A block whose own factor disagrees with it is flagged.
- **An excluded compound is made up with DMSO-free diluent only** and never drags the
  matching target up — the sheet's "Terbium is never matched", made explicit.
- **A missing project section must never blank the screen.** Projects are migrated on open, so
  it cannot normally happen, but module 3 falls back to an empty section rather than throwing
  mid-experiment.

## Open / deferred

- Deeper UI polish (keyboard navigation, sidebar, density) waits until modules 2 and 3 exist,
  so navigation is designed once rather than three times.
- Module 4 (plate-reader output reshaper) stays a stub with a clean seam until 1–3 are done.
