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

/** Module 1 global parameters (the `Setup` sheet). */
export interface TransfectionParams {
  /** Wells per condition, N — `Setup!C4`. */
  wellsPerCondition: number;
  /** DNA per well (ng) — `Setup!C5`. */
  dna_ng_per_well: number;
  /** OptiMEM per well (µl) — `Setup!C6`. */
  optimem_ul_per_well: number;
  /** PEI:DNA ratio (w/w) — `Setup!C7`. */
  peiDnaRatio: number;
  /**
   * Excess factor for the **transfection master mix** — PEI and the OptiMEM that goes with
   * it. `Setup!C8`. It is NOT applied to the per-condition DNA volumes: those stay at 1×
   * (the sheet shows "Total DNA × margin" for reference only).
   */
  margin: number;
  /**
   * Excess factor for the **cell suspension** — DMEM and cells. Kept separate because more
   * is routinely lost on the cell side (counting, settling, the volume left in the
   * reservoir) than on the PEI side, so one shared margin either wasted PEI or left the
   * last wells short of cells.
   */
  cellSuspensionMargin: number;
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
