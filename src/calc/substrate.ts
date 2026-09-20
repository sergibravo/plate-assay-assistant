/**
 * Substrate / detection reagent for module 3.
 *
 * The well is built from three additions — assay buffer, substrate, compound — and the
 * substrate solution is prepared in **the same assay buffer that is already in the well**,
 * so whatever that buffer carries (DMSO, BSA) the substrate solution carries too. That
 * coupling is handled in `dilutions.ts`, which premixes it alongside the other diluents.
 *
 * The only subtlety here is what a quoted dilution refers to. Two conventions are in use:
 *
 * - **BRET / NanoBiT** — the meaningful number is the *final in-well* dilution (furimazine
 *   1:1000). The solution is spiked so that it lands there once diluted in the well: with
 *   80 µl buffer + 10 µl substrate + 10 µl compound, 10 µl of a 1:100 solution ends at
 *   1:1000. Whether that fold is 10× (referenced after the compounds go in) or 9× (before)
 *   is a real choice people make differently, so it is a setting.
 * - **HiBiT kits** — the quoted numbers (substrate 1:100, LgBiT 1:200) are the *prepared*
 *   recipe, added as-is with no fold correction. The app then reports no in-well figure
 *   rather than inventing one.
 */

import type { Warning } from './types';
import { MIN_PIPETTE_UL, round } from './units';

export interface SubstrateComponent {
  id: string;
  name: string;
  /** The N of a 1:N dilution, read according to `SubstrateSettings.basis`. */
  dilution: number;
  notes: string;
}

/**
 * What a quoted dilution is referenced to.
 * - `after-compounds`  — 1× once buffer + substrate + compound are all in the well.
 * - `before-compounds` — 1× in the well before the compound is added.
 * - `as-prepared`      — the kit's own recipe; no fold correction, no in-well claim.
 */
export type SubstrateReference = 'after-compounds' | 'before-compounds' | 'as-prepared';

export interface SubstrateSettings {
  enabled: boolean;
  /** µl of substrate solution added to each well. */
  volumePerWell_ul: number;
  /** Wells to measure. */
  wells: number;
  margin: number;
  reference: SubstrateReference;
  /** Whether `component.dilution` is the prepared solution's or the final well's. */
  basis: 'prepared' | 'in-well';
  components: SubstrateComponent[];
  notes: string;
}

export interface SubstrateComponentResult {
  id: string;
  name: string;
  /** 1:N in the solution you prepare — what the bench sheet needs. */
  preparedDilution: number;
  /** 1:N in the well; `null` when the recipe is not fold-corrected. */
  inWellDilution: number | null;
  /** Stock to pipette into the premix. */
  stock_ul: number;
  notes: string;
}

export interface SubstrateResult {
  enabled: boolean;
  /** How much the solution is diluted in the well, or `null` when not fold-corrected. */
  foldFactor: number | null;
  /** Assay buffer already in the well, once the substrate's own volume is taken out. */
  assayBufferPerWell_ul: number;
  /** `volumePerWell × wells × margin`. */
  required_ul: number;
  components: SubstrateComponentResult[];
  warnings: Warning[];
}

/** The well as it stands when the substrate is added. */
export interface WellContext {
  /** In the well before the compound goes in — assay buffer plus the substrate itself. */
  inWell_ul: number;
  /** Compound solution added per well. */
  compound_ul: number;
  /** The volume of substrate solution actually being premixed, for the stock volumes. */
  prepare_ul: number;
}

/**
 * How much the prepared solution is diluted by the time it counts.
 * `null` for a kit recipe that is used as prepared.
 */
export function substrateFold(s: SubstrateSettings, ctx: WellContext): number | null {
  if (s.reference === 'as-prepared') return null;
  const v = s.volumePerWell_ul;
  if (v <= 0) return null;
  const total = s.reference === 'after-compounds' ? ctx.inWell_ul + ctx.compound_ul : ctx.inWell_ul;
  return total / v;
}

export function computeSubstrate(s: SubstrateSettings, ctx: WellContext): SubstrateResult {
  const warnings: Warning[] = [];
  const warn = (level: Warning['level'], code: string, message: string) =>
    warnings.push({ level, code, scope: 'Substrate', message });

  const fold = substrateFold(s, ctx);
  const required_ul = Math.max(0, s.volumePerWell_ul * s.wells * s.margin);
  const assayBufferPerWell_ul = ctx.inWell_ul - s.volumePerWell_ul;

  const components: SubstrateComponentResult[] = s.components.map((c) => {
    // `prepared` is always what goes into the tube; `in-well` is what the cells see.
    const preparedDilution = s.basis === 'in-well' && fold ? c.dilution / fold : c.dilution;
    const inWellDilution = fold ? preparedDilution * fold : null;
    const stock_ul = preparedDilution > 0 ? ctx.prepare_ul / preparedDilution : 0;
    return { id: c.id, name: c.name, preparedDilution, inWellDilution, stock_ul, notes: c.notes };
  });

  if (s.enabled) {
    if (s.volumePerWell_ul <= 0) warn('error', 'substrate-no-volume', 'Substrate volume per well must be greater than 0.');
    if (s.wells <= 0) warn('error', 'substrate-no-wells', 'Set the number of wells to measure.');
    if (assayBufferPerWell_ul < -1e-9) {
      warn(
        'error',
        'substrate-exceeds-well',
        `${s.volumePerWell_ul} µl of substrate does not fit in the ${ctx.inWell_ul} µl already in the well. Raise the volume in the well, or lower the substrate volume.`,
      );
    }
    for (const c of components) {
      if (c.preparedDilution <= 1) {
        warn('error', 'substrate-dilution', `${c.name}: a 1:${round(c.preparedDilution, 3)} dilution is not a dilution — check the number and the basis.`);
      } else if (c.stock_ul > 0 && c.stock_ul < MIN_PIPETTE_UL) {
        warn(
          'warn',
          'substrate-below-min-pipette',
          `${c.name}: only ${c.stock_ul.toFixed(3)} µl of stock is needed — below the ${MIN_PIPETTE_UL} µl minimum. Prepare a larger volume of substrate solution.`,
        );
      }
    }
    if (s.components.length === 0) warn('warn', 'substrate-no-components', 'No substrate components listed — nothing to dilute.');
  }

  return { enabled: s.enabled, foldFactor: fold, assayBufferPerWell_ul, required_ul, components, warnings };
}

let seq = 0;
const cid = () => `sub_${(seq += 1)}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Per-assay starting points, from how this lab runs them. Applied on request, never
 * silently over the top of someone's numbers.
 */
export function defaultSubstrate(assay: 'NanoBiT/BRET' | 'HiBiT' | 'DERET'): SubstrateSettings {
  const base = { enabled: true, wells: 96, margin: 1.2, notes: '' };
  switch (assay) {
    case 'HiBiT':
      // Kit recipe: added as prepared, so no fold correction is claimed.
      return {
        ...base,
        volumePerWell_ul: 50,
        reference: 'as-prepared',
        basis: 'prepared',
        components: [
          { id: cid(), name: 'HiBiT Extracellular substrate', dilution: 100, notes: '1:100 from stock' },
          { id: cid(), name: 'LgBiT protein', dilution: 200, notes: '1:200 from stock' },
        ],
      };
    case 'DERET':
      // Furimazine is the diluent for the compounds themselves; not calculated yet.
      return { ...base, enabled: false, volumePerWell_ul: 10, reference: 'after-compounds', basis: 'in-well', components: [] };
    default:
      return {
        ...base,
        volumePerWell_ul: 10,
        reference: 'after-compounds',
        basis: 'in-well',
        components: [{ id: cid(), name: 'Substrate (e.g. furimazine)', dilution: 1000, notes: '1:1000 in the well' }],
      };
  }
}

export function newSubstrateComponent(name = ''): SubstrateComponent {
  return { id: cid(), name, dilution: 100, notes: '' };
}
