/**
 * Shared data model for the plate-assay assistant.
 *
 * Everything in `src/calc` is pure: no React, no DOM, no I/O. The science can be
 * audited (and unit-tested) here without reading a line of UI code.
 */

export type PlateFormat = '96-well' | 'half-area 96-well' | '384-well';

export interface PlateGeometry {
  rows: number;
  cols: number;
  rowLabels: string[];
}

const ROWS_96 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const PLATE_GEOMETRY: Record<PlateFormat, PlateGeometry> = {
  '96-well': { rows: 8, cols: 12, rowLabels: ROWS_96 },
  // Same 8 × 12 footprint, smaller wells: only the working volumes differ.
  'half-area 96-well': { rows: 8, cols: 12, rowLabels: ROWS_96 },
  '384-well': {
    rows: 16,
    cols: 24,
    rowLabels: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'],
  },
};

/** A plasmid / DNA stock kept in the reusable inventory. */
export interface DnaStock {
  id: string;
  /** Lab plasmid ID, e.g. a pEK number. Free text — printed on the bench sheet. */
  plasmidId: string;
  name: string;
  /** ng/µl. `null` when unknown — volumes then render as "—" rather than lying. */
  stockConc_ng_per_ul: number | null;
  notes: string;
  /** The filler (e.g. pcDNA) tops every condition up to 100 %. Exactly one per experiment. */
  isFiller: boolean;
}

export type Vehicle = 'aqueous' | 'DMSO';

/** A compound / ligand kept in the reusable inventory (module 3). */
export interface Compound {
  id: string;
  name: string;
  stockConc_uM: number;
  vehicle: Vehicle;
  /** e.g. Terbium — never DMSO-matched. */
  excludeFromVehicleMatch: boolean;
  notes: string;
}

/**
 * Where the transfection happens: reverse transfection straight into a 96-well plate, or a
 * dish (cells seeded together with the mix, as in the plate) to be replated later.
 */
export type TransfectionMode = 'plate' | 'dish';

export type DishSize = '6-well' | '6 cm' | '10 cm';

/** One dish (for '6-well', one well of the plate). Units are the ones typed at the bench. */
export interface DishParams {
  size: DishSize;
  /** Total DNA per dish (µg). */
  dna_ug: number;
  /** OptiMEM in the DNA tube, per dish (µl). */
  optimemForDna_ul: number;
  /** OptiMEM in the PEI mix, per dish (µl). */
  optimemForPei_ul: number;
  /** Cells per dish (millions). */
  cells_M: number;
  /** DMEM the cells are seeded in, per dish (ml). */
  medium_ml: number;
  /** Extra PEI master mix (µl) — as `transfectionMixExtra_ul`, for dishes. */
  mixExtra_ul: number;
  /** Extra cell suspension (µl) — as `cellSuspensionExtra_ul`, for dishes. */
  cellExtra_ul: number;
}

/**
 * Lab defaults per dish size. 6 cm is the reference; 6-well and 10 cm are scaled from it by
 * growth area and rounded, except the medium, which is what the lab actually uses.
 */
export const DISH_DEFAULTS: Record<DishSize, Omit<DishParams, 'size' | 'mixExtra_ul' | 'cellExtra_ul'>> = {
  '6-well': { dna_ug: 1.5, optimemForDna_ul: 75, optimemForPei_ul: 75, cells_M: 0.5, medium_ml: 2 },
  '6 cm': { dna_ug: 3, optimemForDna_ul: 150, optimemForPei_ul: 150, cells_M: 1.2, medium_ml: 3 },
  '10 cm': { dna_ug: 8, optimemForDna_ul: 400, optimemForPei_ul: 400, cells_M: 3, medium_ml: 5 },
};

export function defaultDish(size: DishSize = '6 cm'): DishParams {
  return { size, ...DISH_DEFAULTS[size], mixExtra_ul: 0, cellExtra_ul: 0 };
}

/** Module 1 global parameters (the `Setup` sheet). */
export interface TransfectionParams {
  mode: TransfectionMode;
  /** Free text, printed on the bench sheet. */
  cellLine: string;
  /** Used in dish mode only; the plate fields below are left as they were. */
  dish: DishParams;
  /** Wells per condition, N — `Setup!C4`. A condition can override it (`wells`). */
  wellsPerCondition: number;
  /** DNA per well (ng) — `Setup!C5`. */
  dna_ng_per_well: number;
  /** OptiMEM per well (µl) — `Setup!C6`. */
  optimem_ul_per_well: number;
  /** PEI:DNA ratio (w/w) — `Setup!C7`. */
  peiDnaRatio: number;
  /**
   * Extra µl of **transfection master mix** (PEI + its OptiMEM) beyond what the conditions
   * need, split between the two in proportion. An amount rather than a percentage, because
   * that is how the excess is actually decided at the bench: "make 500 µl more".
   * Per-condition DNA volumes are untouched by it.
   */
  transfectionMixExtra_ul: number;
  /**
   * Extra µl of **cell suspension** (DMEM), with the cells scaled to keep the same density.
   * Separate from the mix above because more is routinely lost on the cell side — counting,
   * settling, what stays in the reservoir.
   */
  cellSuspensionExtra_ul: number;
  /** Cells per well (thousands) — `Setup!F4` (the sheet stored millions; we store k). */
  cells_k_per_well: number;
  /** DMEM per well (µl) — `Setup!F5`. */
  dmem_ul_per_well: number;
  /** `Setup!F6`. */
  plateFormat: PlateFormat;
  /**
   * How the OptiMEM volume in each DNA tube is derived from "OptiMEM per well":
   * - `fixed`      — add exactly `opti_ul × N / 2` µl of OptiMEM (the sheet's behaviour);
   *                  the tube ends up slightly larger than that once DNA is added.
   * - `final-volume` — `opti_ul × N / 2` is the *target total* for the tube, so the
   *                  OptiMEM added is that minus the DNA volume already in it.
   */
  optimemMode: 'fixed' | 'final-volume';
  /** PEI stock (µg/µl) — `Setup!I4`. */
  pei_ug_per_ul: number;
  optimemLot: string;
  peiLot: string;
}

/** One DNA line inside one condition of the DNA-mix grid. */
export interface DnaMixEntry {
  dnaStockId: string;
  /** User-entered % of the total DNA. `null` = row left empty (filler rows compute their own). */
  pct: number | null;
}

/** One condition = one cell of the Dim A × Dim B grid. */
export interface TransfectionCondition {
  id: string;
  /** Auto label, e.g. "A2" / "C1" — column index + row-group index. */
  code: string;
  /** User label, e.g. "low hibit". */
  label: string;
  entries: DnaMixEntry[];
  /**
   * Wells (plate mode) or dishes (dish mode) for this condition; `null` takes the default.
   * Kept apart so switching mode never reads a 32-well count as 32 dishes.
   */
  wells: number | null;
  dishes: number | null;
}

export interface DnaMixGrid {
  /** Columns across (Dim A) — `DNA Mixes!F4`. */
  cols: number;
  /** Row groups down (Dim B) — `DNA Mixes!F5`. */
  rowGroups: number;
  colLabels: string[];
  rowGroupLabels: string[];
  /** Row-major: conditions[rowGroup][col]. */
  conditions: TransfectionCondition[][];
}

/** Non-blocking user-facing warning. Correctness is surfaced, never silently swallowed. */
export interface Warning {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  /** Where it came from, e.g. "condition:A2" or "block:Iso/row:3". */
  scope?: string;
}
