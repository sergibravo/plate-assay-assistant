/**
 * DERET-specific preparations: the fluorescein the whole assay sits in, and the terbium
 * labelling reagent.
 *
 * Reference: `DERTET calculation.xlsx › Reagents`, simplified to fit the rest of module 3.
 *
 * Two things make DERET different from NanoBiT/BRET:
 *
 * - **Fluorescein is everywhere.** The cells get buffer with fluorescein at 1×, and the
 *   compounds arrive in 1× fluorescein too, so the acceptor concentration never changes
 *   when a compound goes in. It therefore belongs in the assay buffer batch that every
 *   other diluent is made from, exactly like BSA.
 * - **Terbium comes first and then leaves.** Cells are labelled with Tb, which is washed
 *   out before the assay proper, so it never enters the well's composition — it is simply
 *   its own preparation, sized by the wells it has to label.
 */

import type { Warning } from './types';
import { MIN_PIPETTE_UL, round } from './units';

/**
 * Fluorescein reaches the working buffer through a chain of dilutions — 100 mM stock, an
 * intermediate held in the freezer, then into the buffer itself. Each step is described by
 * what it is, so the bench sheet can say "take X of this into Y of that".
 */
export interface FluoresceinSettings {
  enabled: boolean;
  /** What the buffer (and so the well) sits at — 50 µM by default, 50–100 µM in practice. */
  target_uM: number;
  /** The intermediate the buffer is made from: 1 mM. */
  intermediate_uM: number;
  /** The freezer stock the intermediate is made from: 100 mM = 100 000 µM. */
  stock_uM: number;
  /** Extra intermediate to prepare beyond what the buffer needs. */
  intermediateExtra_ul: number;
}

export interface TbSettings {
  enabled: boolean;
  /** µl of Tb solution per well to label. */
  volumePerWell_ul: number;
  wells: number;
  /** Prepared at 1:N from the Tb stock. */
  dilution: number;
  /** Extra µl beyond what the wells take. */
  extraVolume_ul: number;
  notes: string;
}

/** One step of a dilution chain: take `stock_ul` of the source into `diluent_ul` of buffer. */
export interface DilutionStep {
  name: string;
  /** What this step produces. */
  product_uM: number;
  from_uM: number;
  /** 1:N. */
  fold: number;
  prepare_ul: number;
  stock_ul: number;
  diluent_ul: number;
}

export interface FluoresceinResult {
  enabled: boolean;
  /** The fraction of the assay buffer that is fluorescein intermediate, for carrier maths. */
  volumeFractionOfBuffer: number;
  /** Into the buffer batch: made from the intermediate. */
  intoBuffer: DilutionStep | null;
  /** Making the intermediate itself, from the freezer stock. */
  intermediate: DilutionStep | null;
  warnings: Warning[];
}

export interface TbResult {
  enabled: boolean;
  required_ul: number;
  stock_ul: number;
  diluent_ul: number;
  warnings: Warning[];
}

function step(
  name: string,
  from_uM: number,
  product_uM: number,
  prepare_ul: number,
): DilutionStep {
  const fold = product_uM > 0 ? from_uM / product_uM : 0;
  const stock_ul = fold > 0 ? prepare_ul / fold : 0;
  return { name, product_uM, from_uM, fold, prepare_ul, stock_ul, diluent_ul: Math.max(0, prepare_ul - stock_ul) };
}

/**
 * @param bufferVolume_ul the assay buffer batch the fluorescein has to go into.
 */
export function computeFluorescein(f: FluoresceinSettings, bufferVolume_ul: number): FluoresceinResult {
  const warnings: Warning[] = [];
  const warn = (level: Warning['level'], code: string, message: string) =>
    warnings.push({ level, code, scope: 'Fluorescein', message });

  if (!f.enabled) {
    return { enabled: false, volumeFractionOfBuffer: 0, intoBuffer: null, intermediate: null, warnings };
  }

  if (f.target_uM <= 0) warn('error', 'fluorescein-no-target', 'Fluorescein working concentration must be greater than 0.');
  if (f.intermediate_uM <= f.target_uM) {
    warn(
      'error',
      'fluorescein-chain',
      `The intermediate (${round(f.intermediate_uM, 3)} µM) must be more concentrated than the working buffer (${round(f.target_uM, 3)} µM).`,
    );
  }
  if (f.stock_uM <= f.intermediate_uM) {
    warn(
      'error',
      'fluorescein-stock',
      `The stock (${round(f.stock_uM, 1)} µM) must be more concentrated than the intermediate (${round(f.intermediate_uM, 3)} µM).`,
    );
  }

  const intoBuffer = step('Fluorescein into the assay buffer', f.intermediate_uM, f.target_uM, bufferVolume_ul);
  const intermediateNeeded = intoBuffer.stock_ul + Math.max(0, f.intermediateExtra_ul);
  const intermediate = step('Fluorescein intermediate', f.stock_uM, f.intermediate_uM, intermediateNeeded);

  for (const s of [intoBuffer, intermediate]) {
    if (s.prepare_ul > 0 && s.stock_ul > 0 && s.stock_ul < MIN_PIPETTE_UL) {
      warn(
        'warn',
        'fluorescein-below-min-pipette',
        `${s.name}: only ${s.stock_ul.toFixed(3)} µl to pipette — below the ${MIN_PIPETTE_UL} µl minimum. Prepare more, or use a less concentrated source.`,
      );
    }
  }

  return {
    enabled: true,
    volumeFractionOfBuffer: bufferVolume_ul > 0 ? intoBuffer.stock_ul / bufferVolume_ul : 0,
    intoBuffer,
    intermediate,
    warnings,
  };
}

export function computeTb(tb: TbSettings): TbResult {
  const warnings: Warning[] = [];
  if (!tb.enabled) return { enabled: false, required_ul: 0, stock_ul: 0, diluent_ul: 0, warnings };

  const required_ul = Math.max(0, tb.volumePerWell_ul * tb.wells + Math.max(0, tb.extraVolume_ul));
  const stock_ul = tb.dilution > 0 ? required_ul / tb.dilution : 0;

  if (tb.dilution <= 1) {
    warnings.push({ level: 'error', code: 'tb-dilution', scope: 'Terbium', message: `A 1:${round(tb.dilution, 3)} dilution is not a dilution — check the number.` });
  }
  if (tb.wells <= 0) {
    warnings.push({ level: 'error', code: 'tb-wells', scope: 'Terbium', message: 'Set the number of wells to label.' });
  }
  if (stock_ul > 0 && stock_ul < MIN_PIPETTE_UL) {
    warnings.push({
      level: 'warn',
      code: 'tb-below-min-pipette',
      scope: 'Terbium',
      message: `Only ${stock_ul.toFixed(3)} µl of Tb stock is needed — below the ${MIN_PIPETTE_UL} µl minimum. Prepare more than the wells strictly take.`,
    });
  }

  return { enabled: true, required_ul, stock_ul, diluent_ul: Math.max(0, required_ul - stock_ul), warnings };
}

export function defaultFluorescein(): FluoresceinSettings {
  return { enabled: true, target_uM: 50, intermediate_uM: 1000, stock_uM: 100000, intermediateExtra_ul: 20 };
}

export function defaultTb(): TbSettings {
  return { enabled: true, volumePerWell_ul: 50, wells: 96, dilution: 1000, extraVolume_ul: 100, notes: 'Added before everything else and washed out once the cells are labelled.' };
}
