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

## Module 3 corrections (2026-09-20)

- **"Override target" was misread as a volume.** The DMSO panel now says the numbers are
  concentrations in so many words, and the field reads "Force a different % (optional)" with
  a `% DMSO` unit. Naming a field after what it does to the maths is not enough; it has to
  say what it *is*.
- **BSA carrier is matched the same way DMSO is**, but more simply: both diluents get the
  same BSA fraction, so no two-buffer split is needed. The user sets the % wanted, whether
  that % refers to the prepared buffer or the final well, and the BSA stock strength (which
  varies between lots). A compound whose stock already carries BSA declares it per block.
- **The diluents now come with a premix recipe** — base buffer + DMSO + BSA stock for each —
  because "premix 2984 µl of DMSO buffer" is not actionable on its own.

## Module 3 corrections, round 2 (2026-09-20)

- **One addition, entered as volumes.** There used to be a per-block dilution factor *and* a
  global "in-well dilution on addition"; nobody could say which was which. Now the experiment
  states the addition the way it is pipetted — "10 µl into 90 µl" — and shows the resulting
  ×. That single factor prepares the tubes and sets the in-well DMSO. A block can still
  override it, and is flagged when it does, because that compound's well then differs from
  the rest.
- **Two DMSO strategies, because both are used.** `compound-only`: the well buffer is
  DMSO-free and all the DMSO arrives with the compound, matched so every compound spikes
  identically. `all-buffers`: the well buffer is premixed at the same DMSO as the tubes, so
  the concentration never changes — steadier for the cells, at a final DMSO `f ×` higher.
  BSA carries the same choice, defaulting to `all-buffers`, which is how this lab prepares it.
- **Premixes always round up.** Buffers are cheap; running out mid-preparation is not. Volumes
  go up to the next 10/50/100/500 µl, and the exact requirement is printed beside it.
- **The prepared volume is a suggestion, not a verdict.** "Needed" and "Prepare" are both
  shown, and Prepare is editable: someone wanting a round 5 ml, or topping up a bottle, types
  it and the DMSO and BSA are recalculated for that volume. Clearing the cell returns to the
  suggestion. The app warns rather than overrules when the number set is below what the
  compounds consume, or leaves an additive unpipettable.
- **An unpipettable additive raises the batch instead of raising a warning.** A 0.4 µl BSA
  addition used to produce a warning and leave the user to solve it; now the premix is scaled
  until the addition clears 0.5 µl, and the app says which additive forced it, what the
  volume had been, and that a weaker stock would need less.

## Substrate (2026-09-20)

- **The substrate is premixed with the other diluents**, not off to one side, because it has
  to be made up in the same assay buffer as the well — so it inherits that buffer's DMSO and
  BSA automatically when placement says the well buffer carries them.
- **One dilution convention: the final concentration in the well.** A "prepared vs in-well"
  basis toggle and an "as prepared (kit recipe)" reference were both tried and removed — they
  were two ways of saying the same thing and neither read clearly. Everything is quoted where
  it matters biologically, and the app works back to the tube. Kit recipes are entered as
  their in-well equivalent (HiBiT substrate 1:200, LgBiT 1:400 for an equal-volume addition).
- **Whether the spike is 1× before or after the compounds is a setting**, because people
  differ: 10 µl into 80 + 10 + 10 is 10× referenced after, 9× referenced before.
- **The well is volumes, not an ordering.** Plain assay buffer, substrate and compound are
  three independent volumes and any may be zero, so "nothing in the well, add 50 µl at 1×" is
  expressible. The previous model asked for "what is already in the well", which forced an
  order of pipetting and rejected an empty well.
- **The substrate volume is editable wherever it is shown.** It appeared read-only in the
  addition panel, which read as fixed by the assay when it is only a default. Both panels now
  edit the same setting.
- **Defaults are per assay, not per current selection.** One button per assay, so the HiBiT
  recipe can be loaded without first switching the whole experiment over.
- Assay defaults are **offered, never imposed**: a button loads the usual recipe for the
  selected assay instead of overwriting whatever is there when the assay type changes.

## Premixes from ready-made buffer (2026-09-20)

- **Everything is made from one batch of assay buffer.** Asked directly, Sergi confirmed the
  lab keeps a batch already containing the BSA and makes each premix from it, rather than
  rebuilding from plain buffer every time. The bench sheet now prints that order: batch
  first, then each diluent taken from it. Fewer pipetting steps, which is what matters.
- **Carrier displacement is reported, and corrected only when correcting helps.** Stocks
  added to that buffer dilute its BSA and DMSO slightly. Under 2 % relative the app states
  the achieved figure and leaves it alone — at that size the corrective pipetting introduces
  more error than it removes, and Sergi's instruction was to optimise for pipetting ease, not
  the last decimal. Past 2 % it tops up, provided the top-up itself is pipettable.
- A premix that needs *less* carrier than the batch holds cannot come from it, and falls back
  to plain buffer. Each row says which base it starts from, so the sheet is never ambiguous.

## Corrections after first use (2026-09-21)

- **The two master mixes get their own margins.** One shared margin meant either wasted PEI
  or too little cell suspension, because the cell side loses more (counting, settling, dead
  volume in the reservoir). Old projects carry their single margin into both, so nothing
  computed before changes.
- **The mouse wheel no longer edits numbers.** A focused `input[type=number]` changes value
  when the wheel passes over it, so picking a stock concentration and then scrolling silently
  shifted it by a unit or two. A global listener drops focus on wheel instead.
- **Buffers are named by their contents** in every recipe and on the bench sheet. "Assay
  buffer" alone was ambiguous the moment some of it carried BSA and some did not.
- **Plain buffer is left off the recipe.** It lives in a large bottle and needs no making up,
  so neither the batch (when nothing is added to it) nor a compound diluent that is just plain
  buffer earns a row. One line reports the total the run takes off the shelf, counted once.
- **A premix that needs nothing added is an allocation, not a preparation.** The well buffer
  was appearing as a third thing to make when it is simply part of the batch poured off. The
  table now separates "prepare, in this order" from "then pour off, no additions", and the
  batch total already includes the poured portions.

## HiBiT substrate confirmed (2026-09-21)

- **HiBiT: substrate 1:100 and LgBiT 1:200, in the well, counted before the compounds.**
  Sergi confirmed the kit numbers are in-well figures, not the reagent recipe — an earlier
  guess had converted them to 1:200 / 1:400 for an equal-volume addition, which was wrong.
  HiBiT is no longer flagged as having an uncalculated substrate.
- **An override announces itself.** A per-compound "Added differently" value now appears in
  that compound's panel heading, and the warnings name the field and the panel rather than
  just the number, because the value itself proved hard to find in a long page.

## Deliberately not doing (2026-09-21)

- **No reusable inventories.** The spec asked for DNA stocks, compounds and buffers persisted
  across experiments; Sergi is content to type them per experiment. The unused `compounds`
  field in the project file is the only leftover.
- **No Duplicate button.** A replicate is handled by opening the project, renaming it in the
  header and saving — the filename follows the name, so the parent file is untouched. Offered
  and declined; the Save flow is enough.

## DERET, and excess as an amount (2026-09-22)

- **Excess is stated as a volume, not a percentage.** "Prepare 500 µl more" is how it is
  decided at the bench; a margin factor made people compute backwards from a number they did
  not choose. Every margin became an extra: transfection mix, cell suspension, each compound
  tube, the substrate, Tb. Old projects convert to the amounts their margins stood for.
- **DERET is fluorescein, not furimazine.** An earlier guess from the original brief had it
  as furimazine; the assay is terbium → fluorescein, and the acceptor sits in every buffer.
- **Fluorescein belongs in the batch.** The cells' buffer and the compound solutions must
  carry the same 1× fluorescein, so it goes into the one batch everything is drawn from —
  the same place BSA goes. It is prepared through its own chain: 100 mM freezer stock → 1 mM
  intermediate → into the buffer at 1:20 for 50 µM.
- **The batch never carries DMSO.** Forced by DERET: with DMSO in the batch, the DMSO-free
  compound diluent could not be drawn from it and fell back to plain buffer — silently losing
  the fluorescein. The batch now holds only what every diluent needs, and DMSO is added per
  diluent, which is also how the reference sheet prepares them.
- **Terbium is a preparation, not an ingredient.** It labels the cells before the assay and
  is washed out, so it is sized from the wells it labels and stays out of the well
  composition and the DMSO matching entirely.

## DERET follow-ups (2026-09-22)

- **DERET has no substrate section at all** — it is not merely hidden. A substrate left
  switched on from another assay was still counted in the well volume and so in the addition
  factor, which is a wrong number reached through an invisible field. One helper,
  `substrateInWell`, now decides it for the engine and the UI together.
- **Fluorescein stocks are entered in mM**, since 100 mM and 1 mM are how they are labelled;
  the working concentration stays in µM. The engine holds µM throughout and the panel
  converts.
- **Well counts are derived *or* typed.** The count the series covers is always shown, and a
  typed count overrides it — the plate is what you know, and a series rarely fills it exactly.
- **Buffer channels are listed beside the compounds, as rows rather than blocks.** A single
  "vehicle alone" volume was not enough: there can be several, and each needs a name and a
  say in which diluent it is made of. They have no dilution series, so they never become
  compound blocks, but their volume reaches the diluents, the batch and its fluorescein.
- (superseded) Vehicle alone was a single volume, not a compound. It goes into wells like a compound does, so
  it is prepared as more of the matched diluent and counted in every buffer total, but it has
  no dilution series and never appears as a block at the bottom of the page.
- **The fluorescein panel says what the batch is for** — cells versus compounds, needed
  versus drawn, with vehicle alone on its own line — because "prepare 13 ml" invites the
  question of where it all goes, and an amount folded into a total is an amount nobody can
  check. The premix row for the matched diluent says it includes the vehicle too.
- **A pinned premix volume hides what feeds it.** An override fixes the prepared volume, so
  adding a vehicle channel changed the *needed* figure while the prepared one, and therefore
  the batch and its fluorescein, stayed put. That is correct behaviour but it reads as the
  vehicle being ignored, which is why both figures are now shown side by side.
- (superseded) Well counts were derived, not typed. Each step prepares `volForWells` µl and each well
  takes the addition volume, so the count falls out of the series — shown read-only. Wells
  the compounds never reach are added as extra well buffer, in µl, like every other excess.
  Terbium keeps its own well count because it labels cells before any compound exists.
- **The DNA inventory can be reordered by dragging** (or ↑ ↓), and the condition blocks
  follow, because every condition's rows are rebuilt from the inventory order.

## Volumes read like pipettes (2026-09-30)

- **Two decimals at 10 µl and below, one above.** The precision shown is the precision a
  pipette can deliver; anything finer is noise on a bench sheet. One pair of helpers
  (`roundUl`, `fmtUl`) does it, a `µl` field applies it by default, and both exports use it,
  so the rule cannot drift apart between screen and paper. Calculations are untouched — they
  stay at full precision and round only at the last moment.

## Module 2 (2026-09-30)

- **The plate is painted, not configured.** Pick a paint, then click or drag. Treatments live
  on the wells rather than as column defaults, which removes the earlier "is a seeded row
  crossing a treated column in play?" ambiguity entirely. Transfections keep a row default
  because Sergi sometimes seeds a whole row and sometimes a single well.
- **A well holding two treatments is split diagonally**, each half in its own colour with its
  own label. Showing one colour and a `+1` count was tried first and read as a mystery; the
  split says what is in the well without being read anywhere else. Wells and the exported
  cells are wider to fit two labels. Excel cannot split a cell, so a shared well there is
  filled from the first treatment and names both.
- **The brush is held in a ref as well as state.** Choosing a paint and clicking a well in the
  same frame painted with the *previous* brush, because the well's handler was built before
  the click that changed it. In a lab tool the first click after choosing something must do
  what it says.
- **Erasing drags like painting.** An eraser is just another paint. Right-click lifts only the
  last treatment off a well, leaving the rest — asked for after right-click-to-clear proved
  too blunt for layered wells.
- **One palette for the whole app.** A compound's colour is stored on its block and editable
  from the plate, and its dilution steps shade from it, palest at the lowest dose. A colour
  that means one thing on screen and another on paper would be worse than none.
- **The plate sizes the compound dilutions.** Wells painted with a step × the volume added per
  well replaces the typed figure for that step; unpainted steps keep theirs. The substrate is
  deliberately left out, since it is not painted well by well.

## Two machines, one direction (2026-10-07)

- **Development happens in one place; the work computer gets only the built HTML**, used to
  run experiments. Experiments travel as `.assay.json` files in a synced folder, since browser
  storage does not.
- **A file saved by a newer build is refused, not read.** That workflow makes version skew
  likely: the copy at work lags behind, and migrations only run forwards, so an unrecognised
  file would otherwise be read as if it were current and produce numbers that look plausible.
  The app now says which format the file is, which one it understands, and to copy the newer
  HTML over.

## Open / deferred

- Deeper UI polish (keyboard navigation, sidebar, density) waits until modules 2 and 3 exist,
  so navigation is designed once rather than three times.
- Module 4 (plate-reader output reshaper) stays a stub with a clean seam until 1–3 are done.
- Module 3 is complete for NanoBiT/BRET, HiBiT and DERET.
