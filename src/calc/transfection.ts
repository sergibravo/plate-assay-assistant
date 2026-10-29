/**
 * Module 1 — reverse-transfection reagent calculator.
 *
 * Source of truth: `260821_hibit_transfection_optimisation_dilutions_template.xlsx`,
 * sheets `Setup`, `PEI Mix`, `DNA Mixes`. Cell references in comments are from that file.
 */

import type {
  DnaMixGrid,
  DnaStock,
  TransfectionCondition,
  TransfectionParams,
  Warning,
} from './types';
import { ceilingTo1, MIN_PIPETTE_UL } from './units';

/**
 * What one unit receives — a well of the 96-well plate, or one dish — in the units the maths
 * uses. Both modes go through this, so a dish is computed exactly like a well that happens
 * to be bigger: every condition gets the same mix per unit, only the number of units differs.
 */
export interface UnitRecipe {
  unit: 'well' | 'dish';
  /** Units a condition gets unless it says otherwise. */
  defaultUnits: number;
  dna_ng: number;
  optimemForDna_ul: number;
  optimemForPei_ul: number;
  /** `(dna × ratio) / 1000 / stock` — ng→µg, then ÷ (µg/µl). */
  pei_ul: number;
  cells_k: number;
  /** DMEM the cells are seeded in. */
  medium_ul: number;
  mixExtra_ul: number;
  cellExtra_ul: number;
}

export function unitRecipe(p: TransfectionParams): UnitRecipe {
  const pei = (dna_ng: number) => (dna_ng * p.peiDnaRatio) / 1000 / p.pei_ug_per_ul;
  if (p.mode === 'dish') {
    const d = p.dish;
    const dna_ng = d.dna_ug * 1000;
    return {
      unit: 'dish',
      defaultUnits: 1,
      dna_ng,
      optimemForDna_ul: d.optimemForDna_ul,
      optimemForPei_ul: d.optimemForPei_ul,
      pei_ul: pei(dna_ng),
      cells_k: d.cells_M * 1000,
      medium_ul: d.medium_ml * 1000,
      mixExtra_ul: d.mixExtra_ul,
      cellExtra_ul: d.cellExtra_ul,
    };
  }
  return {
    unit: 'well',
    defaultUnits: p.wellsPerCondition,
    dna_ng: p.dna_ng_per_well,
    // `Setup!C26`/`C27`: the OptiMEM per well is split evenly between the two tubes.
    optimemForDna_ul: p.optimem_ul_per_well / 2,
    optimemForPei_ul: p.optimem_ul_per_well / 2,
    pei_ul: pei(p.dna_ng_per_well),
    cells_k: p.cells_k_per_well,
    medium_ul: p.dmem_ul_per_well,
    mixExtra_ul: p.transfectionMixExtra_ul,
    cellExtra_ul: p.cellSuspensionExtra_ul,
  };
}

/** "1 dish", "2 dishes", "12 wells" — or just the noun when `n` is omitted (plural). */
export function unitLabel(unit: UnitRecipe['unit'], n?: number): string {
  const noun = n === 1 ? unit : unit === 'dish' ? 'dishes' : 'wells';
  return n === undefined ? noun : `${n} ${noun}`;
}

/** Wells or dishes this condition is prepared for: its own count, else the default. */
export function unitsFor(p: TransfectionParams, c: Pick<TransfectionCondition, 'wells' | 'dishes'>): number {
  const own = p.mode === 'dish' ? c.dishes : c.wells;
  return own ?? unitRecipe(p).defaultUnits;
}

export interface PerConditionTotals {
  /** Wells or dishes these totals are for. */
  units: number;
  /** `Setup!C23 = C5*C4` */
  totalDna_ng: number;
  /** `Setup!C24` — reference only; no downstream volume uses it. */
  totalDnaWithMargin_ng: number;
  /** `Setup!C25 = ((C5*C4)*C7)/1000/I4` — ng→µg, then ÷ (µg/µl). */
  pei_ul: number;
  /** `Setup!C26 = (C6*C4)/2` */
  optimemForDna_ul: number;
  /** `Setup!C27 = (C6*C4)/2` */
  optimemForPei_ul: number;
  /** `Setup!C28 = F5*C4` */
  dmem_ul: number;
  /** `Setup!C29 = F4*C4`, in thousands of cells. */
  cells_k: number;
  /** PEI + its OptiMEM: what goes from the master mix into this condition's DNA tube. */
  peiMix_ul: number;
}

/** One condition's totals, for `units` wells or dishes (the default count if omitted). */
export function perCondition(p: TransfectionParams, units = unitRecipe(p).defaultUnits): PerConditionTotals {
  const u = unitRecipe(p);
  const totalDna_ng = u.dna_ng * units;
  const pei_ul = u.pei_ul * units;
  const optimemForPei_ul = u.optimemForPei_ul * units;
  return {
    units,
    totalDna_ng,
    totalDnaWithMargin_ng: totalDna_ng,
    pei_ul,
    optimemForDna_ul: u.optimemForDna_ul * units,
    optimemForPei_ul,
    dmem_ul: u.medium_ul * units,
    cells_k: u.cells_k * units,
    peiMix_ul: pei_ul + optimemForPei_ul,
  };
}

export interface MasterMixTotals {
  nConditions: number;
  /** Wells or dishes across every condition — what the mix and the cells are sized from. */
  totalUnits: number;
  /** `PEI Mix!C5` — for a condition at the default count. */
  peiPerCondition_ul: number;
  /** Enough for every condition, plus its share of the extra. */
  totalPei_ul: number;
  /** `PEI Mix!C7` — for a condition at the default count. */
  optimemForPeiPerCondition_ul: number;
  /** Whole µl: OptiMEM is measured with a serological pipette, not to two decimals. */
  totalOptimemForPei_ul: number;
  /** `PEI Mix!F4 = Setup!F5*Setup!C4*C4`, at the cell-suspension margin. */
  dmemTotal_ul: number;
  /** `PEI Mix!F5 = Setup!F4*Setup!C4*Setup!C8*C4`, in thousands of cells. */
  totalCells_k: number;
  /** `PEI Mix!F6 = Setup!F5*Setup!C4` — for a condition at the default count. */
  cellSuspensionPerCondition_ul: number;
}

/**
 * PEI master mix + cell suspension. `conditions` is either how many conditions there are,
 * all at the default count, or the wells/dishes of each condition in turn.
 */
export function masterMix(p: TransfectionParams, conditions: number | number[]): MasterMixTotals {
  const u = unitRecipe(p);
  const units = typeof conditions === 'number' ? Array.from({ length: conditions }, () => u.defaultUnits) : conditions;
  const totalUnits = units.reduce((a, b) => a + b, 0);
  const per = perCondition(p);

  // The extra is extra *mix*, so it keeps the PEI:OptiMEM ratio of the mix itself.
  const mixPerUnit = u.pei_ul + u.optimemForPei_ul;
  const peiShare = mixPerUnit > 0 ? u.pei_ul / mixPerUnit : 0;
  const extra = Math.max(0, u.mixExtra_ul);

  // Extra suspension carries its own cells, at the density the wells are seeded at.
  const cellExtra = Math.max(0, u.cellExtra_ul);
  const cellsPerUl = u.medium_ul > 0 ? u.cells_k / u.medium_ul : 0;

  /*
   * OptiMEM is rounded up to a whole µl. It is the diluent, not the reagent: the PEI:DNA
   * ratio depends on the PEI volume alone, so a fraction of a µl more diluent changes
   * nothing — while a figure like 576.32 µl is measured out as 576 anyway, and asks the
   * person at the bench to do the rounding themselves.
   */
  return {
    nConditions: units.length,
    totalUnits,
    peiPerCondition_ul: per.pei_ul,
    totalPei_ul: u.pei_ul * totalUnits + extra * peiShare,
    optimemForPeiPerCondition_ul: per.optimemForPei_ul,
    totalOptimemForPei_ul: ceilingTo1(u.optimemForPei_ul * totalUnits + extra * (1 - peiShare)),
    dmemTotal_ul: u.medium_ul * totalUnits + cellExtra,
    totalCells_k: u.cells_k * totalUnits + cellExtra * cellsPerUl,
    cellSuspensionPerCondition_ul: per.dmem_ul,
  };
}

export interface DnaMixRow {
  dnaStockId: string;
  name: string;
  /** Effective % — user value, or the auto-computed filler top-up. */
  pct: number;
  isFiller: boolean;
  /** True when this row's % was computed, not typed. */
  pctIsComputed: boolean;
  /** `ng = (Setup!C5*Setup!C4) * pct/100` */
  ng: number;
  /** `µl = ng / stockConc`; `null` (rendered "—") when the stock conc is unknown or 0. */
  ul: number | null;
}

export interface DnaMixResult {
  conditionId: string;
  code: string;
  label: string;
  rows: DnaMixRow[];
  totalPct: number;
  totalNg: number;
  /** Sum of the pipettable volumes; unknown-stock rows contribute 0 and raise a warning. */
  totalUl: number;
  /** `IF(sum=100,"✓ OK","⚠ ≠ 100%")` */
  pctOk: boolean;
  /**
   * OptiMEM to actually pipette into this DNA tube.
   * - `fixed` mode: the full `Setup!C26` volume, as the sheet does.
   * - `final-volume` mode: `Setup!C26 − (DNA volume already in the tube)`, so the tube
   *   lands on the stated total. Clamped at 0; a warning fires if the DNA overshoots.
   */
  optimemForDna_ul: number;
  /** The tube's total volume once DNA + OptiMEM are combined. */
  tubeTotal_ul: number;
  /** The `Setup!C26` figure the mode is derived from — shown for reference. */
  optimemTarget_ul: number;
  /** True when every user-entered % is empty: the block is unused and stays hidden. */
  isEmpty: boolean;
  /** Wells or dishes this condition is prepared for. */
  units: number;
  /** True when the condition sets its own count rather than taking the default. */
  unitsOverridden: boolean;
  /** PEI + OptiMEM from the master mix to add to this condition's DNA tube. */
  peiMix_ul: number;
  /** Cell suspension for this condition, and the cells in it (k). */
  cellSuspension_ul: number;
  cells_k: number;
  warnings: Warning[];
}

/** Filler %: `MAX(0, 100 − Σ other %)` — `DNA Mixes!D14`. */
export function fillerPct(otherPcts: (number | null)[]): number {
  const sum = otherPcts.reduce<number>((a, b) => a + (b ?? 0), 0);
  return Math.max(0, 100 - sum);
}

export function computeCondition(
  p: TransfectionParams,
  condition: TransfectionCondition,
  stocks: DnaStock[],
): DnaMixResult {
  const units = unitsFor(p, condition);
  const per = perCondition(p, units);
  const stockById = new Map(stocks.map((s) => [s.id, s]));
  const warnings: Warning[] = [];
  const scope = `condition:${condition.code}`;
  const unitName = unitRecipe(p).unit;

  const fillerId = stocks.find((s) => s.isFiller)?.id ?? null;
  const nonFillerPcts = condition.entries
    .filter((e) => e.dnaStockId !== fillerId)
    .map((e) => e.pct);

  // A block counts as "in use" only if a non-filler % was actually typed; an
  // untouched block would otherwise look like 100 % filler and clutter the grid.
  const isEmpty = nonFillerPcts.every((v) => v === null || v === undefined);

  const rows: DnaMixRow[] = condition.entries.map((entry) => {
    const stock = stockById.get(entry.dnaStockId);
    const isFiller = entry.dnaStockId === fillerId;
    const pct = isFiller && !isEmpty ? fillerPct(nonFillerPcts) : (entry.pct ?? 0);
    const ng = (per.totalDna_ng * pct) / 100;
    const conc = stock?.stockConc_ng_per_ul ?? null;
    const ul = !conc || ng === 0 ? null : ng / conc;

    if (ng > 0 && !conc) {
      warnings.push({
        level: 'warn',
        code: 'unknown-stock-conc',
        scope,
        message: `${stock?.name ?? entry.dnaStockId}: stock concentration unknown — volume cannot be calculated.`,
      });
    }
    if (ul !== null && ul > 0 && ul < MIN_PIPETTE_UL) {
      warnings.push({
        level: 'warn',
        code: 'below-min-pipette',
        scope,
        message: `${stock?.name ?? entry.dnaStockId}: ${ul.toFixed(3)} µl is below the ${MIN_PIPETTE_UL} µl minimum — pre-dilute the stock or raise the ${unitName} count.`,
      });
    }

    return {
      dnaStockId: entry.dnaStockId,
      name: stock?.name ?? '(unknown DNA)',
      pct,
      isFiller,
      pctIsComputed: isFiller && !isEmpty,
      ng,
      ul,
    };
  });

  const optimemTarget_ul = per.optimemForDna_ul;
  const totalPct = rows.reduce((a, r) => a + r.pct, 0);
  const totalNg = rows.reduce((a, r) => a + r.ng, 0);
  const totalUl = rows.reduce((a, r) => a + (r.ul ?? 0), 0);
  // Tolerance absorbs float noise from percentages like 0.1 + 0.2.
  const pctOk = Math.abs(totalPct - 100) < 1e-9;

  if (!isEmpty && !pctOk) {
    warnings.push({
      level: 'error',
      code: 'pct-not-100',
      scope,
      message: `DNA composition sums to ${totalPct.toFixed(2)} %, not 100 %.`,
    });
  }
  const finalVolumeMode = p.optimemMode === 'final-volume';
  const optimemForDna_ul = finalVolumeMode
    ? Math.max(0, optimemTarget_ul - totalUl)
    : optimemTarget_ul;
  const tubeTotal_ul = optimemForDna_ul + totalUl;

  if (!isEmpty && totalUl > optimemTarget_ul) {
    warnings.push({
      level: 'warn',
      code: 'dna-exceeds-optimem',
      scope,
      message: finalVolumeMode
        ? `DNA volume (${totalUl.toFixed(1)} µl) already exceeds the ${optimemTarget_ul} µl target volume for this tube — no OptiMEM fits.`
        : `DNA volume (${totalUl.toFixed(1)} µl) exceeds the OptiMEM for this tube (${optimemTarget_ul} µl).`,
    });
  }
  if (!isEmpty && !(Number.isInteger(units) && units >= 1)) {
    warnings.push({
      level: 'error',
      code: 'units',
      scope,
      message: `${condition.code}: ${unitLabel(unitName, units)} is not a whole number of at least 1.`,
    });
  }
  if (!isEmpty && finalVolumeMode && optimemForDna_ul > 0 && optimemForDna_ul < MIN_PIPETTE_UL) {
    warnings.push({
      level: 'warn',
      code: 'optimem-below-min-pipette',
      scope,
      message: `Only ${optimemForDna_ul.toFixed(3)} µl of OptiMEM is left to add — below the ${MIN_PIPETTE_UL} µl minimum.`,
    });
  }

  return {
    conditionId: condition.id,
    code: condition.code,
    label: condition.label,
    rows,
    totalPct,
    totalNg,
    totalUl,
    pctOk,
    optimemForDna_ul,
    tubeTotal_ul,
    optimemTarget_ul,
    isEmpty,
    units,
    unitsOverridden: (p.mode === 'dish' ? condition.dishes : condition.wells) != null,
    peiMix_ul: per.peiMix_ul,
    cellSuspension_ul: per.dmem_ul,
    cells_k: per.cells_k,
    warnings,
  };
}

export interface GridResult {
  conditions: DnaMixResult[];
  /** Blocks actually in use — what the PEI master mix should be sized for. */
  activeCount: number;
  /** Wells or dishes of each block in use, in order — pass to `masterMix`. */
  activeUnits: number[];
  warnings: Warning[];
}

export function computeGrid(p: TransfectionParams, grid: DnaMixGrid, stocks: DnaStock[]): GridResult {
  const flat = grid.conditions.flat();
  const conditions = flat.map((c) => computeCondition(p, c, stocks));
  const active = conditions.filter((c) => !c.isEmpty);
  const warnings = conditions.flatMap((c) => c.warnings);

  if (stocks.filter((s) => s.isFiller).length !== 1) {
    warnings.unshift({
      level: 'warn',
      code: 'filler-count',
      message: `Exactly one DNA stock must be marked as filler (currently ${stocks.filter((s) => s.isFiller).length}).`,
    });
  }
  return { conditions, activeCount: active.length, activeUnits: active.map((c) => c.units), warnings };
}

/** Sanity checks on the global parameters themselves. */
export function validateParams(p: TransfectionParams): Warning[] {
  const w: Warning[] = [];
  const push = (code: string, message: string, level: Warning['level'] = 'error') =>
    w.push({ level, code, message, scope: 'setup' });

  const u = unitRecipe(p);
  if (u.unit === 'well' && !(Number.isInteger(p.wellsPerCondition) && p.wellsPerCondition >= 1)) {
    push('wells', 'Wells per condition must be a whole number of at least 1.');
  }
  if (u.dna_ng <= 0) push('dna', `DNA per ${u.unit} must be greater than 0.`);
  if (p.pei_ug_per_ul <= 0) push('pei-stock', 'PEI stock concentration must be greater than 0.');
  if (u.mixExtra_ul < 0) push('mix-extra', 'Extra transfection mix cannot be negative.');
  if (u.cellExtra_ul < 0) push('cell-extra', 'Extra cell suspension cannot be negative.');
  if (u.optimemForDna_ul <= 0 || u.optimemForPei_ul <= 0) push('optimem', `OptiMEM per ${u.unit} must be greater than 0.`, 'warn');
  if (u.unit === 'dish' && u.cells_k <= 0) push('cells', 'Cells per dish must be greater than 0.', 'warn');
  if (u.unit === 'dish' && u.medium_ul <= 0) push('medium', 'DMEM per dish must be greater than 0.');

  const per = perCondition(p);
  if (per.pei_ul > 0 && per.pei_ul < MIN_PIPETTE_UL) {
    push('pei-min-pipette', `PEI per condition is ${per.pei_ul.toFixed(3)} µl — below the ${MIN_PIPETTE_UL} µl minimum. Prepare a master mix or dilute the PEI stock.`, 'warn');
  }
  return w;
}
