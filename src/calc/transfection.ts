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
import { MIN_PIPETTE_UL } from './units';

export interface PerConditionTotals {
  /** `Setup!C23 = C5*C4` */
  totalDna_ng: number;
  /** `Setup!C24 = C5*C4*C8` */
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
}

export function perCondition(p: TransfectionParams): PerConditionTotals {
  const totalDna_ng = p.dna_ng_per_well * p.wellsPerCondition;
  return {
    totalDna_ng,
    totalDnaWithMargin_ng: totalDna_ng * p.margin,
    pei_ul: (totalDna_ng * p.peiDnaRatio) / 1000 / p.pei_ug_per_ul,
    optimemForDna_ul: (p.optimem_ul_per_well * p.wellsPerCondition) / 2,
    optimemForPei_ul: (p.optimem_ul_per_well * p.wellsPerCondition) / 2,
    dmem_ul: p.dmem_ul_per_well * p.wellsPerCondition,
    cells_k: p.cells_k_per_well * p.wellsPerCondition,
  };
}

export interface MasterMixTotals {
  nConditions: number;
  /** `PEI Mix!C5` */
  peiPerCondition_ul: number;
  /** `PEI Mix!C6 = C5*C4*Setup!C8` */
  totalPei_ul: number;
  /** `PEI Mix!C7` */
  optimemForPeiPerCondition_ul: number;
  /** `PEI Mix!C8 = C7*C4*Setup!C8` */
  totalOptimemForPei_ul: number;
  /** `PEI Mix!F4 = Setup!F5*Setup!C4*Setup!C8*C4` */
  dmemTotal_ul: number;
  /** `PEI Mix!F5 = Setup!F4*Setup!C4*Setup!C8*C4`, in thousands of cells. */
  totalCells_k: number;
  /** `PEI Mix!F6 = Setup!F5*Setup!C4` */
  cellSuspensionPerCondition_ul: number;
}

/** PEI master mix + cell suspension across `nConditions` conditions. */
export function masterMix(p: TransfectionParams, nConditions: number): MasterMixTotals {
  const per = perCondition(p);
  return {
    nConditions,
    peiPerCondition_ul: per.pei_ul,
    totalPei_ul: per.pei_ul * nConditions * p.margin,
    optimemForPeiPerCondition_ul: per.optimemForPei_ul,
    totalOptimemForPei_ul: per.optimemForPei_ul * nConditions * p.margin,
    dmemTotal_ul: p.dmem_ul_per_well * p.wellsPerCondition * p.margin * nConditions,
    totalCells_k: p.cells_k_per_well * p.wellsPerCondition * p.margin * nConditions,
    cellSuspensionPerCondition_ul: p.dmem_ul_per_well * p.wellsPerCondition,
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
  const per = perCondition(p);
  const stockById = new Map(stocks.map((s) => [s.id, s]));
  const warnings: Warning[] = [];
  const scope = `condition:${condition.code}`;

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
        message: `${stock?.name ?? entry.dnaStockId}: ${ul.toFixed(3)} µl is below the ${MIN_PIPETTE_UL} µl minimum — pre-dilute the stock or raise the well count.`,
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
    warnings,
  };
}

export interface GridResult {
  conditions: DnaMixResult[];
  /** Blocks actually in use — what the PEI master mix should be sized for. */
  activeCount: number;
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
  return { conditions, activeCount: active.length, warnings };
}

/** Sanity checks on the global parameters themselves. */
export function validateParams(p: TransfectionParams): Warning[] {
  const w: Warning[] = [];
  const push = (code: string, message: string, level: Warning['level'] = 'error') =>
    w.push({ level, code, message, scope: 'setup' });

  if (p.wellsPerCondition <= 0) push('wells', 'Wells per condition must be greater than 0.');
  if (p.dna_ng_per_well <= 0) push('dna', 'DNA per well must be greater than 0.');
  if (p.pei_ug_per_ul <= 0) push('pei-stock', 'PEI stock concentration must be greater than 0.');
  if (p.margin < 1) push('margin', 'Margin factor below 1× prepares less than you need.', 'warn');
  if (p.optimem_ul_per_well <= 0) push('optimem', 'OptiMEM per well must be greater than 0.', 'warn');

  const per = perCondition(p);
  if (per.pei_ul > 0 && per.pei_ul < MIN_PIPETTE_UL) {
    push('pei-min-pipette', `PEI per condition is ${per.pei_ul.toFixed(3)} µl — below the ${MIN_PIPETTE_UL} µl minimum. Prepare a master mix or dilute the PEI stock.`, 'warn');
  }
  return w;
}
