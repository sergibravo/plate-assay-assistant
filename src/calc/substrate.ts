/**
 * Substrate / detection reagent for module 3.
 *
 * The well is built from three additions — assay buffer, substrate, compound — and the
 * substrate solution is prepared in **the same assay buffer that is already in the well**,
 * so whatever that buffer carries (DMSO, BSA) the substrate solution carries too. That
 * coupling is handled in `dilutions.ts`, which premixes it alongside the other diluents.
 *
 * Dilutions are always quoted as the **final concentration in the well** — the number that
 * means something biologically — and the app works back to what to put in the tube. With
 * 80 µl buffer + 10 µl substrate + 10 µl compound, furimazine at 1:1000 in the well is
 * prepared at 1:100, because the solution is diluted 10× on its way in.
 *
 * Whether that fold counts the compound addition (10×) or stops before it (9×) is a real
 * choice people make differently, so it is a setting.
 */

import type { Warning } from './types';
import { MIN_PIPETTE_UL, round } from './units';

export interface SubstrateComponent {
  id: string;
  name: string;
  /** The N of a 1:N dilution **in the well**. */
  dilution: number;
  notes: string;
}

/**
 * When the quoted dilution is meant to hold.
 * - `after-compounds`  — 1× once buffer + substrate + compound are all in the well.
 * - `before-compounds` — 1× in the well before the compound is added.
 */
export type SubstrateReference = 'after-compounds' | 'before-compounds';

export interface SubstrateSettings {
  enabled: boolean;
  /** µl of substrate solution added to each well. */
  volumePerWell_ul: number;
  /** Wells to measure. */
  wells: number;
  /** Extra µl beyond what the wells take. */
  extraVolume_ul: number;
  reference: SubstrateReference;
  components: SubstrateComponent[];
  notes: string;
}

export interface SubstrateComponentResult {
  id: string;
  name: string;
  /** 1:N in the solution you prepare — what the bench sheet needs. */
  preparedDilution: number;
  /** 1:N in the well — what the user typed. */
  inWellDilution: number;
  /** Stock to pipette into the premix. */
  stock_ul: number;
  notes: string;
}

export interface SubstrateResult {
  enabled: boolean;
  /** How much the solution is diluted on its way into the well. */
  foldFactor: number;
  /** Assay buffer in the well alongside the substrate. */
  assayBufferPerWell_ul: number;
  /** `volumePerWell × wells × margin`. */
  required_ul: number;
  components: SubstrateComponentResult[];
  warnings: Warning[];
}

/**
 * The well, as a set of volumes rather than an ordering — nothing here depends on what is
 * pipetted first, so an empty well (no assay buffer at all) is perfectly legal.
 */
export interface WellContext {
  /** Plain assay buffer per well. May be 0. */
  assayBuffer_ul: number;
  /** Compound solution added per well. May be 0. */
  compound_ul: number;
  /** The volume of substrate solution actually being premixed, for the stock volumes. */
  prepare_ul: number;
}

/** How much the prepared solution is diluted by the time the quoted dilution counts. */
export function substrateFold(s: SubstrateSettings, ctx: WellContext): number {
  const v = s.volumePerWell_ul;
  if (v <= 0) return 1;
  const total =
    s.reference === 'after-compounds'
      ? ctx.assayBuffer_ul + v + ctx.compound_ul
      : ctx.assayBuffer_ul + v;
  return total / v;
}

export function computeSubstrate(s: SubstrateSettings, ctx: WellContext): SubstrateResult {
  const warnings: Warning[] = [];
  const warn = (level: Warning['level'], code: string, message: string) =>
    warnings.push({ level, code, scope: 'Substrate', message });

  const fold = substrateFold(s, ctx);
  const required_ul = Math.max(0, s.volumePerWell_ul * s.wells + Math.max(0, s.extraVolume_ul));
  const assayBufferPerWell_ul = ctx.assayBuffer_ul;

  const components: SubstrateComponentResult[] = s.components.map((c) => {
    // The user quotes the well; the tube has to be that much stronger.
    const preparedDilution = c.dilution / fold;
    const stock_ul = preparedDilution > 0 ? ctx.prepare_ul / preparedDilution : 0;
    return { id: c.id, name: c.name, preparedDilution, inWellDilution: c.dilution, stock_ul, notes: c.notes };
  });

  if (s.enabled) {
    if (s.volumePerWell_ul <= 0) warn('error', 'substrate-no-volume', 'Substrate volume per well must be greater than 0.');
    if (s.wells <= 0) warn('error', 'substrate-no-wells', 'Set the number of wells to measure.');
    for (const c of components) {
      if (c.preparedDilution <= 1) {
        warn(
          'error',
          'substrate-dilution',
          `${c.name}: 1:${round(c.inWellDilution, 3)} in the well would need the solution at 1:${round(c.preparedDilution, 3)} — that is not a dilution. Use a more dilute target, or add less substrate per well.`,
        );
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
  const base = { enabled: true, wells: 96, extraVolume_ul: 200, notes: '' };
  switch (assay) {
    case 'HiBiT':
      // 50 µl/well of substrate 1:100 and LgBiT 1:200, both counted in the well and before
      // the compounds go in.
      return {
        ...base,
        volumePerWell_ul: 50,
        reference: 'before-compounds',
        components: [
          { id: cid(), name: 'HiBiT Extracellular substrate', dilution: 100, notes: '1:100 in the well' },
          { id: cid(), name: 'LgBiT protein', dilution: 200, notes: '1:200 in the well' },
        ],
      };
    case 'DERET':
      // Furimazine is the diluent for the compounds themselves; not calculated yet.
      return { ...base, enabled: false, volumePerWell_ul: 10, reference: 'after-compounds', components: [] };
    default:
      return {
        ...base,
        volumePerWell_ul: 10,
        reference: 'after-compounds',
        components: [{ id: cid(), name: 'Substrate (e.g. furimazine)', dilution: 1000, notes: '1:1000 in the well' }],
      };
  }
}

export function newSubstrateComponent(name = ''): SubstrateComponent {
  return { id: cid(), name, dilution: 100, notes: '' };
}
