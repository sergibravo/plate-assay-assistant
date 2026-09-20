/**
 * Module 3 — serial dilution calculator with automatic DMSO vehicle matching.
 *
 * Source of truth: `layout-aquous.xlsx › Compounds` (the improved version), with
 * `…dilutions_template.xlsx › Dilutions` as the simpler precursor. Cell references in the
 * comments are from those files.
 *
 * Two ideas drive everything here:
 *
 * 1. **Back-propagation.** Each tube must hold enough for its own wells *plus* the aliquot
 *    the next, more dilute tube draws from it — so prepared volumes grow towards the top.
 * 2. **Vehicle matching.** Every compound well must end up at the same DMSO %, whatever the
 *    compound's own stock is dissolved in, so DMSO is a constant and not a confound. Each
 *    tube's make-up volume is split between a DMSO-free diluent and one premixed at the
 *    target DMSO fraction.
 *
 * Concentrations are entered as the **final in-well** logM. Each tube is prepared at
 * `dilutionFactor ×` that, because adding it to the well dilutes it by that factor.
 */

import type { Vehicle, Warning } from './types';
import { ceilingTo1, logMToUM, MIN_PIPETTE_UL } from './units';

/**
 * What the compounds are diluted into, and what else the assay needs prepared.
 * Only the compound side is calculated today; `pending` says so out loud per assay.
 */
export type AssayType = 'NanoBiT/BRET' | 'HiBiT' | 'DERET';

export interface AssayProfile {
  /** What the serial dilutions are made up in. */
  diluent: string;
  /** Shown on the buffer panel, e.g. "Assay buffer (no DMSO)". */
  normalBufferName: string;
  dmsoBufferName: string;
  /** Whether the compound side alone is the whole story for this assay. */
  compoundsComplete: boolean;
  /** Parts of this assay the app does not calculate yet. Displayed, never hidden. */
  pending: string[];
}

export const ASSAY_PROFILES: Record<AssayType, AssayProfile> = {
  'NanoBiT/BRET': {
    diluent: 'assay buffer',
    normalBufferName: 'Assay buffer (no DMSO)',
    dmsoBufferName: 'Assay buffer + DMSO',
    compoundsComplete: true,
    pending: ['Substrate is a single addition and is not calculated here.'],
  },
  HiBiT: {
    diluent: 'assay buffer',
    normalBufferName: 'Assay buffer (no DMSO)',
    dmsoBufferName: 'Assay buffer + DMSO',
    compoundsComplete: false,
    pending: [
      'Compounds are diluted in assay buffer exactly as for NanoBiT/BRET, so the numbers below apply.',
      'The HiBiT substrate preparation is more involved and is NOT calculated yet.',
    ],
  },
  DERET: {
    diluent: 'furimazine solution',
    normalBufferName: 'Furimazine solution (no DMSO)',
    dmsoBufferName: 'Furimazine solution + DMSO',
    compoundsComplete: false,
    pending: [
      'For DERET the compounds are diluted in furimazine, not plain assay buffer — the volumes below are correct, but the diluent you prepare must be the furimazine solution.',
      'Preparing that furimazine solution from its stock is NOT calculated yet.',
    ],
  },
};

/**
 * BSA carried by the diluents. Compounds often need a little carrier protein; the stock
 * they come in may or may not already contain it, so the diluents are premixed to the
 * target and each tube reports what it actually reaches.
 */
export interface BsaSettings {
  enabled: boolean;
  /** % BSA (w/v) wanted — read according to `basis`. */
  targetPct: number;
  /** % BSA (w/v) of the stock the diluents are made from, e.g. 5. */
  stockPct: number;
  /**
   * What `targetPct` refers to:
   * - `buffer`  — the prepared diluent itself sits at that %, or
   * - `in-well` — the well sits at that % after the compound side is diluted `inWellFactor`×.
   */
  basis: 'buffer' | 'in-well';
}

/** How to premix one diluent, from the bottom of the tube upwards. */
export interface DiluentRecipe {
  name: string;
  /** Exactly what the blocks consume. */
  required_ul: number;
  /** Rounded up to a whole µl — what to actually prepare. */
  prepare_ul: number;
  /** Pure DMSO to add (0 for the DMSO-free diluent). */
  dmso_ul: number;
  /** BSA stock to add (0 when BSA is off). */
  bsaStock_ul: number;
  /** The rest: plain assay buffer / furimazine solution. */
  base_ul: number;
}

/** One compound's dilution series — a "block" in the spreadsheet. */
export interface CompoundBlock {
  id: string;
  name: string;
  /** `V` — volume needed at each step for the plate (µl). L `E11`. */
  volForWells_ul: number;
  /** `f` — the dilution that happens when the tube is added to the well. L `E12`. */
  dilutionFactor: number;
  /** `S` — stock concentration (µM). L `E13`. */
  stockConc_uM: number;
  /** L `E14`. */
  vehicle: Vehicle;
  /** `m` — margin (×). L `E15`. */
  margin: number;
  /** The sheet notes "Terbium is never matched". */
  excludeFromVehicleMatch: boolean;
  /** One final in-well concentration per row, most concentrated first. `null` = empty row. */
  logM: (number | null)[];
  /** % BSA already in this compound's stock; `null` when the stock carries none. */
  stockBsaPct: number | null;
  /** Free text, e.g. a buffer recipe for this compound. */
  notes: string;
}

export interface DilutionExperiment {
  assayType: AssayType;
  /** Working DMSO fraction override (0.002 = 0.2 %); `null` = use the computed maximum. */
  dmsoOverride: number | null;
  /**
   * How much the tube is diluted on its way into the well, for the in-well DMSO figure.
   * 2 for the usual 50 µl + 50 µl addition. L `E7`.
   */
  inWellFactor: number;
  blocks: CompoundBlock[];
  bsa: BsaSettings;
  /** Buffer recipes etc., carried onto the bench sheet so it is self-contained. */
  bufferNotes: string;
}

export interface TubeRow {
  /** 0 = top (most concentrated). */
  index: number;
  logM: number;
  /** Final in-well concentration. L `C18 = (10^logM)*1e6`. */
  conc_uM: number;
  /** What the tube itself sits at: `conc_uM × dilutionFactor`. */
  tubeConc_uM: number;
  /** `D_i` — volume to prepare (µl). L `D18`. */
  volToPrepare_ul: number;
  /** `E_i` — aliquot drawn in from stock or the tube above (µl). L `E18`/`E19`. */
  aliquotIn_ul: number;
  aliquotFrom: 'stock' | 'above';
  /** L `F18` — DMSO-free diluent. */
  normalBuffer_ul: number;
  /** L `G18` — diluent premixed at the target DMSO fraction. */
  dmsoBuffer_ul: number;
  /** L `H18` — what is left once the tube below has taken its aliquot. */
  leftForWells_ul: number;
  /** The DMSO fraction this tube actually ends up at, for checking against the target. */
  dmsoFraction: number;
  /** The BSA fraction this tube actually ends up at (0 when BSA is off). */
  bsaFraction: number;
}

export interface BlockResult {
  blockId: string;
  name: string;
  rows: TubeRow[];
  /** Σ over rows. */
  totalNormalBuffer_ul: number;
  totalDmsoBuffer_ul: number;
  /** The top row's aliquot — how much stock to take out of the freezer. L `E32`. */
  stockNeeded_ul: number;
  /** True when no row carries a concentration: the block is unused and stays hidden. */
  isEmpty: boolean;
  /** The DMSO load this block imposes, `E_top / D_top` — what feeds the matching target. */
  dmsoLoad: number;
  /** This block is not DMSO-matched (excluded, or the whole experiment has no DMSO). */
  unmatched: boolean;
  warnings: Warning[];
}

export interface DilutionResult {
  assay: AssayProfile;
  /** L `E4` — the highest DMSO load any matched DMSO-vehicle compound imposes. */
  computedTarget: number;
  /** L `E6` — override if set, else the computed maximum. */
  target: number;
  /** L `E7` — `target / inWellFactor`. */
  inWellDmso: number;
  /** The fraction the diluents are premixed at, whatever basis the user chose. */
  bsaBufferFraction: number;
  /** What a well ends up at, after the `inWellFactor` addition. */
  bsaInWell: number;
  blocks: BlockResult[];
  /** Premix these across the whole experiment. */
  totalNormalBuffer_ul: number;
  totalDmsoBuffer_ul: number;
  /** How to make each diluent up, including BSA and DMSO. */
  recipes: DiluentRecipe[];
  warnings: Warning[];
}

/** The rows a block actually uses: leading non-empty entries, in order. */
function usedRows(block: CompoundBlock): number[] {
  return block.logM.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
}

/**
 * Volumes and aliquots — everything that does not depend on the DMSO target.
 * Prepared volumes are computed bottom-up, because each tube has to carry the aliquot the
 * tube below will draw from it.
 */
function geometry(block: CompoundBlock) {
  const logMs = usedRows(block);
  const n = logMs.length;
  const conc = logMs.map(logMToUM);
  const base = block.volForWells_ul * block.margin;

  const volToPrepare: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    volToPrepare[i] =
      i === n - 1
        ? ceilingTo1(base)
        : ceilingTo1(base + (volToPrepare[i + 1] * conc[i + 1]) / conc[i]);
  }

  const aliquotIn: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    aliquotIn[i] =
      i === 0
        ? (volToPrepare[0] * conc[0] * block.dilutionFactor) / block.stockConc_uM
        : (volToPrepare[i] * conc[i]) / conc[i - 1];
  }

  const leftForWells = volToPrepare.map((d, i) => (i === n - 1 ? d : d - aliquotIn[i + 1]));

  return { logMs, conc, volToPrepare, aliquotIn, leftForWells };
}

/** `E_top / D_top` — the DMSO fraction a DMSO-dissolved stock forces on its top tube. */
export function dmsoLoadOf(block: CompoundBlock): number {
  if (block.vehicle !== 'DMSO' || block.excludeFromVehicleMatch) return 0;
  const g = geometry(block);
  if (g.logMs.length === 0) return 0;
  return g.aliquotIn[0] / g.volToPrepare[0];
}

/** L `E4` — match the whole experiment to the worst case. */
export function computeDmsoTarget(blocks: CompoundBlock[]): number {
  return blocks.reduce((max, b) => Math.max(max, dmsoLoadOf(b)), 0);
}

/** The BSA fraction the diluents must be premixed at, given the chosen basis. */
export function bsaBufferFraction(exp: DilutionExperiment): number {
  const { bsa, inWellFactor } = exp;
  if (!bsa.enabled || bsa.targetPct <= 0) return 0;
  const wanted = bsa.targetPct / 100;
  // "in-well" means the compound side is diluted `inWellFactor`× on its way into the well,
  // so the buffer has to start that much stronger.
  return bsa.basis === 'in-well' ? wanted * inWellFactor : wanted;
}

function computeBlock(block: CompoundBlock, target: number, bsaFrac: number): BlockResult {
  const warnings: Warning[] = [];
  const scope = block.name || 'compound';
  const { logMs, conc, volToPrepare, aliquotIn, leftForWells } = geometry(block);
  const n = logMs.length;

  // An excluded compound (the sheet's Terbium) is made up with DMSO-free diluent only.
  const blockTarget = block.excludeFromVehicleMatch ? 0 : target;

  const rows: TubeRow[] = logMs.map((logM, i) => {
    const d = volToPrepare[i];
    const e = aliquotIn[i];
    const makeUp = d - e;

    // L `G18`: the top tube's aliquot carries the stock's own vehicle; lower tubes draw
    // from a tube already sitting at the target, so their make-up is all DMSO buffer.
    let dmsoBuffer = 0;
    if (blockTarget > 0) {
      const carried = i === 0 ? (block.vehicle === 'DMSO' ? e : 0) : e * blockTarget;
      dmsoBuffer = Math.max(0, Math.min(makeUp, d - carried / blockTarget));
    }
    const normalBuffer = makeUp - dmsoBuffer;

    const dmsoVolume = (i === 0 ? (block.vehicle === 'DMSO' ? e : 0) : e * blockTarget) + dmsoBuffer * blockTarget;

    // Both diluents carry BSA at the same fraction, so only the aliquot can pull a tube off
    // target: from the stock (which may or may not contain BSA) or from a tube already on it.
    const bsaCarried =
      i === 0 ? e * ((block.stockBsaPct ?? 0) / 100) : e * bsaFrac;
    const bsaVolume = bsaCarried + makeUp * bsaFrac;

    return {
      index: i,
      logM,
      conc_uM: conc[i],
      tubeConc_uM: conc[i] * block.dilutionFactor,
      volToPrepare_ul: d,
      aliquotIn_ul: e,
      aliquotFrom: i === 0 ? 'stock' : 'above',
      normalBuffer_ul: normalBuffer,
      dmsoBuffer_ul: dmsoBuffer,
      leftForWells_ul: leftForWells[i],
      dmsoFraction: d > 0 ? dmsoVolume / d : 0,
      bsaFraction: d > 0 ? bsaVolume / d : 0,
    };
  });

  const warn = (level: Warning['level'], code: string, message: string) =>
    warnings.push({ level, code, scope, message });

  if (n > 0) {
    if (block.stockConc_uM <= 0) {
      warn('error', 'no-stock-conc', 'Stock concentration must be greater than 0.');
    } else if (aliquotIn[0] > volToPrepare[0]) {
      warn(
        'error',
        'stock-too-dilute',
        `Stock is too dilute: the top tube would need ${aliquotIn[0].toFixed(1)} µl of a ${block.stockConc_uM} µM stock to fill ${volToPrepare[0]} µl. Use a more concentrated stock, or lower the top concentration.`,
      );
    }
    for (let i = 1; i < n; i++) {
      if (conc[i] >= conc[i - 1]) {
        warn(
          'error',
          'rows-not-descending',
          `Row ${i + 1} (${logMs[i]} logM) is not more dilute than the row above — enter the most concentrated at the top.`,
        );
        break;
      }
    }
    rows.forEach((r, i) => {
      if (r.aliquotIn_ul > 0 && r.aliquotIn_ul < MIN_PIPETTE_UL) {
        warn(
          'warn',
          'aliquot-below-min-pipette',
          `Row ${i + 1}: ${r.aliquotIn_ul.toFixed(3)} µl is below the ${MIN_PIPETTE_UL} µl minimum — pre-dilute the stock, or raise the volume for wells.`,
        );
      }
      if (r.leftForWells_ul + 1e-9 < block.volForWells_ul * block.margin) {
        warn('warn', 'not-enough-for-wells', `Row ${i + 1}: only ${r.leftForWells_ul.toFixed(1)} µl is left for the wells.`);
      }
    });
    if (bsaFrac > 0) {
      const worst = rows.reduce((w, r) => Math.max(w, Math.abs(r.bsaFraction - bsaFrac)), 0);
      if (worst > bsaFrac * 0.1) {
        warn(
          'warn',
          'bsa-off-target',
          `BSA in this block reaches ${(rows[0].bsaFraction * 100).toFixed(4)} % against a ${(bsaFrac * 100).toFixed(4)} % buffer target — the stock aliquot pulls it off.`,
        );
      }
    }
    if (blockTarget > 0) {
      const worst = rows.reduce((w, r) => Math.max(w, Math.abs(r.dmsoFraction - blockTarget)), 0);
      if (worst > blockTarget * 0.1) {
        warn(
          'warn',
          'dmso-off-target',
          `DMSO in this block reaches ${(rows[0].dmsoFraction * 100).toFixed(3)} % against a ${(blockTarget * 100).toFixed(3)} % target — it cannot be matched exactly.`,
        );
      }
    }
  }

  return {
    blockId: block.id,
    name: block.name,
    rows,
    totalNormalBuffer_ul: rows.reduce((a, r) => a + r.normalBuffer_ul, 0),
    totalDmsoBuffer_ul: rows.reduce((a, r) => a + r.dmsoBuffer_ul, 0),
    stockNeeded_ul: n > 0 ? aliquotIn[0] : 0,
    isEmpty: n === 0,
    dmsoLoad: dmsoLoadOf(block),
    unmatched: block.excludeFromVehicleMatch || blockTarget === 0,
    warnings,
  };
}

/** Volumes of each ingredient for one premixed diluent. */
function recipe(name: string, required: number, dmsoFrac: number, bsaFrac: number, bsaStockPct: number): DiluentRecipe {
  const prepare = ceilingTo1(required);
  const dmso_ul = prepare * dmsoFrac;
  const bsaStock_ul = bsaStockPct > 0 ? (prepare * bsaFrac * 100) / bsaStockPct : 0;
  return {
    name,
    required_ul: required,
    prepare_ul: prepare,
    dmso_ul,
    bsaStock_ul,
    base_ul: Math.max(0, prepare - dmso_ul - bsaStock_ul),
  };
}

export function computeDilutions(exp: DilutionExperiment): DilutionResult {
  const assay = ASSAY_PROFILES[exp.assayType];
  const computedTarget = computeDmsoTarget(exp.blocks);
  const target = exp.dmsoOverride ?? computedTarget;
  const bsaFrac = bsaBufferFraction(exp);
  const blocks = exp.blocks.map((b) => computeBlock(b, target, bsaFrac));
  const warnings: Warning[] = [];

  if (exp.dmsoOverride !== null && exp.dmsoOverride < computedTarget - 1e-12) {
    const worst = exp.blocks
      .map((b) => ({ name: b.name, load: dmsoLoadOf(b) }))
      .sort((a, b) => b.load - a.load)[0];
    warnings.push({
      level: 'warn',
      code: 'override-below-computed',
      scope: 'DMSO matching',
      message: `The override (${(exp.dmsoOverride * 100).toFixed(3)} %) is below the ${(computedTarget * 100).toFixed(3)} % that ${worst?.name || 'a DMSO stock'} already brings in — that compound cannot be matched down to it.`,
    });
  }

  const mismatched = exp.blocks.filter(
    (b) => usedRows(b).length > 0 && Math.abs(b.dilutionFactor - exp.inWellFactor) > 1e-9,
  );
  if (target > 0 && mismatched.length > 0) {
    warnings.push({
      level: 'info',
      code: 'in-well-factor-mismatch',
      scope: 'DMSO matching',
      message: `In-well DMSO is computed with a ${exp.inWellFactor}× addition, but ${mismatched
        .map((b) => `${b.name || 'a block'} (${b.dilutionFactor}×)`)
        .join(', ')} ${mismatched.length === 1 ? 'uses' : 'use'} a different dilution factor. Check the in-well factor matches how you add the compound.`,
    });
  }

  const totalNormalBuffer_ul = blocks.reduce((a, b) => a + b.totalNormalBuffer_ul, 0);
  const totalDmsoBuffer_ul = blocks.reduce((a, b) => a + b.totalDmsoBuffer_ul, 0);

  if (exp.bsa.enabled) {
    if (exp.bsa.stockPct <= 0) {
      warnings.push({ level: 'error', code: 'bsa-no-stock', scope: 'BSA', message: 'BSA stock % must be greater than 0.' });
    } else if (exp.bsa.stockPct < bsaFrac * 100) {
      warnings.push({
        level: 'error',
        code: 'bsa-stock-too-weak',
        scope: 'BSA',
        message: `A ${exp.bsa.stockPct} % BSA stock cannot make a ${(bsaFrac * 100).toFixed(4)} % diluent.`,
      });
    }
  }

  const recipes = [
    recipe(assay.normalBufferName, totalNormalBuffer_ul, 0, bsaFrac, exp.bsa.enabled ? exp.bsa.stockPct : 0),
    recipe(assay.dmsoBufferName, totalDmsoBuffer_ul, target, bsaFrac, exp.bsa.enabled ? exp.bsa.stockPct : 0),
  ];

  for (const r of recipes) {
    if (r.required_ul > 0 && r.bsaStock_ul > 0 && r.bsaStock_ul < MIN_PIPETTE_UL) {
      warnings.push({
        level: 'warn',
        code: 'bsa-below-min-pipette',
        scope: 'BSA',
        message: `${r.name}: only ${r.bsaStock_ul.toFixed(3)} µl of BSA stock is needed — below the ${MIN_PIPETTE_UL} µl minimum. Prepare a larger volume of diluent, or use a weaker BSA stock.`,
      });
    }
    if (r.required_ul > 0 && r.dmso_ul > 0 && r.dmso_ul < MIN_PIPETTE_UL) {
      warnings.push({
        level: 'warn',
        code: 'dmso-below-min-pipette',
        scope: 'DMSO matching',
        message: `${r.name}: only ${r.dmso_ul.toFixed(3)} µl of DMSO is needed — below the ${MIN_PIPETTE_UL} µl minimum. Prepare a larger volume of diluent, or premix the DMSO in two steps.`,
      });
    }
  }

  return {
    assay,
    computedTarget,
    target,
    inWellDmso: exp.inWellFactor > 0 ? target / exp.inWellFactor : 0,
    bsaBufferFraction: bsaFrac,
    bsaInWell: exp.inWellFactor > 0 ? bsaFrac / exp.inWellFactor : 0,
    blocks,
    totalNormalBuffer_ul,
    totalDmsoBuffer_ul,
    recipes,
    warnings: [...warnings, ...blocks.flatMap((b) => b.warnings)],
  };
}
