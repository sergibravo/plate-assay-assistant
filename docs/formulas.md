# Formula provenance

Every calculation in `src/calc/` traced back to the cell it came from, so the science can
be checked against the original workbooks without reading the app.

Sources:
- **T** = `260821_hibit_transfection_optimisation_dilutions_template.xlsx`
- **L** = `layout-aquous.xlsx` (the improved dilution/DMSO-matching version)

## Module 1 — reverse transfection (`src/calc/transfection.ts`)

| Quantity | Spreadsheet | Formula | Implemented in |
| --- | --- | --- | --- |
| Total DNA / condition (ng) | T `Setup!C23` | `C5*C4` = dna_ng × N | `perCondition` |
| … × margin (ng) | T `Setup!C24` | `C5*C4*C8` | `perCondition` |
| PEI / condition (µl) | T `Setup!C25` | `((C5*C4)*C7)/1000/I4` | `perCondition` |
| OptiMEM for DNA (µl) | T `Setup!C26` | `(C6*C4)/2` | `perCondition` |
| OptiMEM for PEI (µl) | T `Setup!C27` | `(C6*C4)/2` | `perCondition` |
| DMEM / condition (µl) | T `Setup!C28` | `F5*C4` | `perCondition` |
| Cells / condition (k) | T `Setup!C29` | `F4*C4` | `perCondition` |
| Total PEI (µl) | T `PEI Mix!C6` | `C5*C4 + extra × (PEI share of the mix)` | `masterMix` |
| Total OptiMEM for PEI (µl) | T `PEI Mix!C8` | `C7*C4 + extra × (OptiMEM share)` | `masterMix` |
| DMEM total (µl) | T `PEI Mix!F4` | `Setup!F5*Setup!C4*C4 + cell extra` | `masterMix` |
| Total cells (k) | T `PEI Mix!F5` | `Setup!F4*Setup!C4*C4 + cell extra × seeding density` | `masterMix` |
| DNA row ng | T `DNA Mixes!E11` | `(Setup!C5*Setup!C4)*pct/100` | `computeCondition` |
| DNA row µl | T `DNA Mixes!F11` | `ng / stockConc`, `—` if stock blank/0 | `computeCondition` |
| OptiMEM in the DNA tube (`fixed`) | T `DNA Mixes!E20` | `Setup!C26` | `computeCondition` |
| OptiMEM in the DNA tube (`final-volume`) | — (new) | `max(0, Setup!C26 − Σ DNA µl)` | `computeCondition` |
| Filler % | T `DNA Mixes!D14` | `MAX(0, 100 − Σ other %)` | `fillerPct` |
| Composition check | T `DNA Mixes!C20` | `IF(sum=100,"✓ OK","⚠ ≠ 100%")` | `computeCondition` |

Reference values reproduced by the test suite (N=12, 100 ng/well, PEI:DNA 3, PEI 1 µg/µl,
OptiMEM 10 µl/well, margin 1.2, 8 conditions): 1200 ng · 1440 ng · 3.6 µl · 60 µl · 60 µl ·
1200 µl · 360 k cells; master mix 34.56 µl PEI, 576 µl OptiMEM, 11520 µl DMEM, 3456 k cells;
block A2 → 6 ng / 0.6 µl HiBiT, filler 99.5 % → 1194 ng / 1.194 µl, totals 100 / 1200 / 1.794.

### Where the app departs from the sheet's conventions

- **Cells are counted in thousands (k), not millions.** The sheet's `Setup!F4` held
  0.03 M/well; the app holds 30 k/well. All downstream cell numbers are in k, with the
  millions equivalent shown as a hint. Project files saved before this change are
  converted automatically (`migrate`, `src/state/project.ts`).
- **Excess is an amount, not a percentage**, everywhere: `transfectionMixExtra_ul`,
  `cellSuspensionExtra_ul`, a compound block's `extraVolume_ul` per tube, the substrate's and
  Tb's own extras. The mix extra keeps the PEI:OptiMEM ratio; the suspension extra carries
  cells at the seeding density. Projects saved with the old margins are converted to the
  amounts those margins stood for, so nothing computed before changes. Per-condition DNA
  volumes are untouched by any of it.
- **DNA stocks carry a lab ID** (`plasmidId`) alongside the name. It prints on the bench
  sheet next to every DNA line.
- **The OptiMEM volume per DNA tube has two modes** (`optimemMode`): `fixed` reproduces the
  sheet — add `Setup!C26` µl regardless of the DNA volume, so the tube ends up slightly
  bigger; `final-volume` treats `Setup!C26` as the tube's target total and adds
  `Setup!C26 − Σ DNA µl` instead. Both report the resulting tube total. Files saved before
  this option existed default to `fixed`.
- **`half-area 96-well` is a plate format**, sharing the 8 × 12 footprint of a standard 96;
  only the working volumes differ, which the user sets through the per-well fields.
- **The grid is editable in both directions and may be ragged.** Columns and row groups can
  be added or deleted individually; a block counts as a condition only when a % is typed
  in it. `Use` fills a block with an explicit 0 % on every non-filler DNA — which makes the
  filler top up to 100 %, i.e. the sheet's "no receptor" control — and `Clear` empties it.
  So 2 receptor × 2 arrestin amounts plus one empty-vector control = a 2 × 3 grid with the
  two unused blocks cleared, and the app counts 5 conditions.

### Deliberate deviations from the sheet

- `CEILING(x,1)` snaps values within 1e-9 of a whole number before rounding up
  (`src/calc/units.ts`). Excel lets float noise turn a 200 µl tube into 201 µl; we do not.
- Percentage totals are compared to 100 with a 1e-9 tolerance, so `0.1 + 0.2 + 99.7`
  still reads ✓ OK.
- Unknown stock concentration yields `null` → “—”, never a number.

## Module 2 — plate layout

Not built yet. Reference: T `Plate Layout`.

## Module 3 — serial dilution + DMSO matching (`src/calc/dilutions.ts`)

Built. Reference: L `Compounds` (improved), T `Dilutions` (precursor).

| Quantity | Spreadsheet | Formula |
| --- | --- | --- |
| Conc (µM) | L `C18` | `(10^logM)*1e6` |
| Vol to prepare | L `D18` | `IF(next empty, CEILING(V*m,1), CEILING(V*m + (D_next*conc_next)/conc_i, 1))` |
| Aliquot, top row | L `E18` | `(D_top*conc_top*f)/S` |
| Aliquot, lower rows | L `E19` | `(D_i*conc_i)/conc_{i−1}` |
| DMSO buffer | L `G18` | `IF(target=0,0,MAX(0,MIN(D−E, D−(E*[vehicle=DMSO?1:0])/target)))` |
| DMSO buffer, lower rows | L `G19` | same with the aliquot already at target → reduces to `D−E` |
| Normal buffer | L `F18` | `(D−E) − DMSO_buffer` |
| Working DMSO target | L `E4/E6` | `MAX over DMSO compounds of (top aliquot / vol to prepare)`, overridable |
| In-well DMSO | L `E7` | `target / 2` (the 50 µl + 50 µl addition) |
| Left for wells | L `H18` | `IF(next empty, D_i, D_i − E_{i+1})` |

Reference values reproduced by the test suite: three compounds, top row −5 (10 µM), V = 200,
f = 2, m = 1, S = 10000 µM → each draws 0.4 µl stock; target = 0.002 (0.2 % working, 0.1 %
in-well); Iso (aqueous) → Normal 0 µl / DMSO buffer 199.6 µl; Nebi & Carve (DMSO) → Normal
199.6 µl / DMSO buffer 0 µl. Ang II block from T `Dilutions`: V = 200, f = 10, S = 100 µM,
logM −6 → prepare 200 µl, 20 µl stock, 180 µl buffer, 200 µl left for wells; Losartan
(−5, −6; S = 30000 µM) → top tube 220 µl, 0.7333 µl stock, 200 µl left for wells;
Ang(1-7) at logM −4.52 → 30.19951720402018 µM, 60.39903440804036 µl of a 1000 µM stock.

### The addition is the one factor

`f` is the dilution the tube undergoes **when it is added to the well**, entered as the two
volumes actually pipetted: `f = (compound_ul + inWell_ul) / compound_ul`, so 10 µl into 90 µl
is 10×. The logM the user types is therefore the *final in-well* concentration, and each tube
is prepared at `f ×` that — which is why the top aliquot carries the extra `× f`
(`E_top = D_top·conc_top·f/S`) while the ratios between tubes are unaffected. The same factor
governs the in-well DMSO. A block may override it for a compound added differently, which is
flagged because that compound's well will not match the others.

### Where an additive sits (`Placement`)

Both DMSO and BSA carry a placement, and it decides only what the *well* ends at:

| Placement | Well buffer | In-well concentration |
| --- | --- | --- |
| `compound-only` | carries none | `buffer fraction / f` — the cells meet it when the compound arrives |
| `all-buffers` | premixed to the same fraction | `buffer fraction` — constant from the start, `f ×` higher |

Tube volumes are identical either way (asserted by a test); the only difference is the well
buffer's own recipe and the reported in-well figure.

### DERET (`src/calc/deret.ts`) — reference: `DERTET calculation.xlsx › Reagents`

| Quantity | Formula |
| --- | --- |
| Fluorescein into the buffer | `1:(intermediate ÷ target)`, so `batch ÷ fold` of intermediate |
| Fluorescein intermediate | `1:(stock ÷ intermediate)`, sized to what the buffer takes + the extra |
| Tb solution | `volumePerWell × wells + extra` — its own well count, unrelated to the assay's |
| Tb stock | `volume ÷ dilution` (1:1000 by default), the rest diluent |

The well buffer is sized either way round. `wellsCovered = Σ rows × volForWells ÷ compound_ul`
always says what the compound series covers; setting `wells` overrides it with the plate you
actually have, and `wellBufferExtra_ul` adds anything neither captures. Terbium keeps its own
well count, since it labels cells before any compound exists.

**Vehicle alone** (`vehicleChannel_ul`) is the compounds' diluent with no compound in it, so
it is simply more of that diluent — DMSO buffer when anything is matched, plain buffer when
nothing is. It has no dilution series, so it never becomes a block. `bufferUse` splits the
batch into what goes to the cells, to the compounds (vehicle included) and to the substrate.

Fluorescein goes into the **batch** every other diluent is drawn from, so the cells' buffer
and the compound solutions carry it identically and the acceptor never changes when a
compound is added — it is simply another component of the batch, and displaces carrier like
any other stock. Terbium labels the cells first and is washed out, so it never enters the
well composition, is not DMSO-matched, and is sized only by the wells it labels.

### Premixes come from one batch of assay buffer

This lab keeps one batch of ready-made assay buffer — already carrying the BSA, and the DMSO
when every buffer carries it — and makes everything else from it. The app prints the premixes
in that order: the batch first, then each diluent taken from it plus whatever it still needs.

The batch carries only what **every** diluent drawn from it needs: BSA when it is in every
buffer, fluorescein in DERET — never DMSO, since the DMSO-free compound diluent exists
precisely to have none. DMSO is added to the diluents that want it, which is how the
reference sheet prepares them, and it means no diluent ever falls back to plain buffer and
loses the batch's fluorescein.

**Plain buffer is not a preparation.** A row that ends up as plain buffer and nothing else
(`isPlainBuffer`) comes out of the bottle on the shelf, so it is left off the recipe entirely;
only `plainBuffer_ul` reports how much the run consumes, counted once — portions drawn from a
batch consume the batch, not the bottle.

Every buffer is **named by what is in it** — "assay buffer + 0.01 % BSA", never a bare "assay
buffer" — because that ambiguity is what gets mixed up at the bench. A premix that needs
nothing added (`isPlainDraw`) is a portion of the batch rather than another preparation, and
is listed separately as something to pour off; its volume is already inside the batch total,
so there is no double counting.

**Carrier displacement.** Stocks added afterwards displace buffer, so they dilute its carrier:
12 µl of substrate stock in 1200 µl takes 0.0100 % BSA to 0.0099 %. The rule is
`achieved = (base × carried + added) / prepared`, and what happens next depends on size:

| Shortfall | What the app does |
| --- | --- |
| under `NEGLIGIBLE_RELATIVE` (2 %) | reports the achieved figure and leaves it — a correction that small is less accurate than the error it removes |
| over 2 %, top-up ≥ 0.5 µl | adds the top-up, so the premix lands on target, and says so |
| over 2 %, top-up < 0.5 µl | reports it and leaves it, because the correction is not pipettable |

### Premix volumes

`roundUpPremix` rounds a premix up to a volume someone would measure out (next 10 µl below
100, then 50, 100, 500) — buffers are cheap, running short mid-prep is not. The prepared
volume is raised further when a DMSO or BSA addition would otherwise fall under the 0.5 µl
pipetting minimum: `V ≥ MIN/dmsoFraction` and `V ≥ MIN·stock% / (100·bsaFraction)`. Each
recipe reports `scaledUpFor`, and the app says which additive forced it and what the
required volume had been.

The suggestion is only a suggestion: `premixOverrides` lets the user prepare a different
volume per diluent, and the DMSO and BSA additions are recalculated for whatever they enter.
An override replaces the automatic scale-up rather than competing with it, and is warned
about when it falls below what the compounds consume, or when it leaves an additive under
the pipetting minimum (the message names the volume that would clear it).

### Assay types

The assay type never changes a compound volume — it names the diluent, supplies the
substrate defaults, and declares what is still outstanding (asserted by a test):

| Assay | Compounds diluted in | Substrate default | Not yet calculated |
| --- | --- | --- | --- |
| NanoBiT/BRET | assay buffer | 10 µl/well, 1:1000 in the well, counted after compounds | — |
| HiBiT | assay buffer (identical maths) | 50 µl/well, substrate 1:100 and LgBiT 1:200, counted in the well **before** compounds | — |
| DERET | **furimazine solution** | off | preparing the furimazine the compounds are diluted in |

### Substrate (`src/calc/substrate.ts`)

The well is assay buffer + substrate + compound. The substrate solution is prepared in the
same assay buffer as the well, so it is premixed alongside the other diluents and carries
their DMSO and BSA when placement says the well buffer does.

The well is described by **volumes, not by an order of pipetting**: plain assay buffer, the
substrate solution, and the compound. Any of them may be zero — 50 µl of compound into an
empty well is a legal 1× addition — and the totals fall out of the sum:

| Quantity | Formula |
| --- | --- |
| Well volume | `assayBuffer + substrate + compound` |
| Compound diluted by | `well volume / compound` |
| Substrate fold | `after-compounds`: `well volume / substrate` · `before-compounds`: `(assayBuffer + substrate) / substrate` |
| Prepared dilution | `quoted in-well dilution / fold` |
| Volume to prepare | `volumePerWell × wells × margin`, then the usual premix rounding |
| Stock per component | `prepared volume / prepared dilution` |

Dilutions are **always quoted as the final concentration in the well** — the number that
means something biologically — and the app works back to the tube.

Worked case: 80 µl assay buffer + 10 µl substrate + 10 µl compound, furimazine 1:1000 in the
well → fold 10×, prepared 1:100, 12 µl of stock in 1200 µl of solution. Referenced *before*
the compounds instead, fold is 9× and the solution is 1:111.1. The HiBiT defaults are 50 µl/well of
substrate at 1:100 and LgBiT at 1:200, both in-well and counted before the compounds go in
(confirmed by Sergi, 2026-09-21).

### BSA carrier (not in the sheet)

Compounds often need carrier protein. Both diluents are premixed with BSA at the same
fraction, so BSA — like DMSO — is constant across every compound well:

| Quantity | Formula |
| --- | --- |
| Buffer BSA fraction | `basis = 'buffer' ? target : target × inWellFactor` |
| BSA stock per diluent | `prepared volume × buffer fraction ÷ (stock % / 100)` |
| Base buffer per diluent | `prepared volume − DMSO − BSA stock` |
| BSA in a tube | `(aliquot × stock BSA + make-up × buffer fraction) ÷ volume` |

`basis` settles the ambiguity in "0.01 % final": either the prepared diluent sits at that %,
or the well does after the `inWellFactor` addition. A compound whose stock already contains
BSA declares it per block; a stock without BSA leaves its top tube a hair under target
(199.6 µl of diluent cannot fill 200 µl), which is computed and reported rather than assumed
away. Worked case: 0.01 % from a 5 % stock = 2 µl of stock per 1 ml of diluent.

### An invariant worth knowing

For the `compound-only` placement the DMSO a well ends at is just
`top concentration / stock concentration` — the addition factor cancels out, since the tube
is prepared `f ×` stronger and then diluted `f ×`. Changing volumes therefore cannot lower
in-well DMSO; only a more concentrated stock or a lower top dose can. The app says so when
the figure passes `DMSO_IN_WELL_CONCERN` (1 %), which is where most cells start to object.

### Additions beyond the sheet

- An **excluded** compound (the sheet's Terbium) is made up with DMSO-free diluent only, and
  never contributes to the computed target.
- Validation: a stock too dilute to reach the top concentration, rows entered out of order,
  aliquots below the 0.5 µl pipetting minimum, an override below the load a DMSO stock
  already brings in, and a tube that cannot be matched exactly (reported with the fraction
  it actually reaches).
- Each row reports `dmsoFraction`, the DMSO the tube truly ends at. An aqueous top tube lands
  a hair under target (199.6 µl of DMSO diluent cannot fill 200 µl); every other tube is
  exact.
