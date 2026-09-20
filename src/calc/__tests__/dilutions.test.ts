import { describe, expect, it } from 'vitest';
import {
  computeDilutions,
  computeDmsoTarget,
  roundUpPremix,
  type CompoundBlock,
  type DilutionExperiment,
} from '../dilutions';

const block = (over: Partial<CompoundBlock> = {}): CompoundBlock => ({
  id: over.id ?? 'b',
  name: over.name ?? 'compound',
  volForWells_ul: 200,
  dilutionFactorOverride: null,
  stockConc_uM: 10000,
  vehicle: 'aqueous',
  margin: 1,
  excludeFromVehicleMatch: false,
  logM: [],
  stockBsaPct: null,
  notes: '',
  ...over,
});

const NO_BSA = { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' as const };

/** 100 µl into 100 µl — the sheet's 50 + 50 addition, i.e. 2×. */
const ADDITION_2X = { compound_ul: 100, inWell_ul: 100 };

const experiment = (blocks: CompoundBlock[], over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
  assayType: 'NanoBiT/BRET',
  dmsoOverride: null,
  addition: ADDITION_2X,
  dmsoPlacement: 'compound-only' as const,
  blocks,
  bsa: NO_BSA,
  bufferNotes: '',
  ...over,
});

/**
 * Acceptance test 2 — `…dilutions_template.xlsx › Dilutions`, the Ang II and Losartan
 * blocks, reproduced against the values stored in the sheet.
 */
describe('back-propagation (Dilutions sheet)', () => {
  it('Ang II: single row, V=200, f=10, S=100 µM, logM −6', () => {
    const r = computeDilutions(
      experiment([block({ name: 'AngII', dilutionFactorOverride: 10, stockConc_uM: 100, logM: [-6] })]),
    ).blocks[0];

    expect(r.rows).toHaveLength(1);
    const [top] = r.rows;
    expect(top.conc_uM).toBeCloseTo(1, 12); // C10
    expect(top.volToPrepare_ul).toBe(200); // D10
    expect(top.aliquotIn_ul).toBeCloseTo(20, 12); // E10
    expect(top.normalBuffer_ul + top.dmsoBuffer_ul).toBeCloseTo(180, 12); // F10
    expect(top.leftForWells_ul).toBe(200); // G10
    expect(r.stockNeeded_ul).toBeCloseTo(20, 12); // F23
  });

  it('Losartan: two rows, S=30000 µM, logM −5 then −6', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Losartan', dilutionFactorOverride: 10, stockConc_uM: 30000, logM: [-5, -6] })]),
    ).blocks[0];

    const [top, bottom] = r.rows;
    expect(top.conc_uM).toBeCloseTo(10, 12); // Q10
    expect(top.volToPrepare_ul).toBe(220); // R10 = CEILING(200 + 200*1/10, 1)
    expect(top.aliquotIn_ul).toBeCloseTo(0.7333333333333333, 12); // S10
    expect(top.leftForWells_ul).toBe(200); // U10 = 220 − 20
    expect(bottom.volToPrepare_ul).toBe(200); // R11
    expect(bottom.aliquotIn_ul).toBeCloseTo(20, 12); // S11 = 200*1/10
    expect(bottom.leftForWells_ul).toBe(200); // U11
    expect(r.stockNeeded_ul).toBeCloseTo(0.7333333333333333, 12); // T23
  });

  it('Ang(1-7): a non-round logM still reproduces the sheet', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Ang(1-7)', dilutionFactorOverride: 10, stockConc_uM: 1000, logM: [-4.52] })]),
    ).blocks[0];
    expect(r.rows[0].conc_uM).toBeCloseTo(30.19951720402018, 12); // J10
    expect(r.rows[0].aliquotIn_ul).toBeCloseTo(60.39903440804036, 12); // L10
    expect(r.rows[0].normalBuffer_ul + r.rows[0].dmsoBuffer_ul).toBeCloseTo(139.60096559195964, 12); // M10
  });

  it('volumes grow towards the top, because each tube carries the one below it', () => {
    const r = computeDilutions(
      experiment([block({ name: 'series', dilutionFactorOverride: 2, stockConc_uM: 10000, logM: [-5, -6, -7, -8] })]),
    ).blocks[0];
    const vols = r.rows.map((x) => x.volToPrepare_ul);
    expect(vols).toEqual([...vols].sort((a, b) => b - a));
    expect(vols.at(-1)).toBe(200); // the terminal tube only needs its own wells
    // every tube keeps V×m for its wells after the tube below has drawn
    for (const row of r.rows) expect(row.leftForWells_ul).toBeGreaterThanOrEqual(200);
  });
});

/**
 * Acceptance test 3 — `layout-aquous.xlsx › Compounds`: Iso (aqueous), Nebi and Carve
 * (DMSO), all at logM −5, V = 200, f = 2, m = 1, stocks 10000 µM.
 */
describe('DMSO vehicle matching (Compounds sheet)', () => {
  const iso = block({ id: 'iso', name: 'Iso', vehicle: 'aqueous', logM: [-5] });
  const nebi = block({ id: 'nebi', name: 'Nebi', vehicle: 'DMSO', logM: [-5] });
  const carve = block({ id: 'carve', name: 'Carve', vehicle: 'DMSO', logM: [-5] });
  const result = computeDilutions(experiment([iso, nebi, carve]));

  it('every compound draws 0.4 µl of stock (E18/M18/U18)', () => {
    for (const b of result.blocks) expect(b.stockNeeded_ul).toBeCloseTo(0.4, 12);
  });

  it('the working DMSO target computes to 0.002 (E4/E6)', () => {
    expect(computeDmsoTarget(experiment([iso, nebi, carve]))).toBeCloseTo(0.002, 12);
    expect(result.target).toBeCloseTo(0.002, 12);
  });

  it('in-well DMSO is half the working target (E7)', () => {
    expect(result.inWellDmso).toBeCloseTo(0.001, 12);
  });

  it('Iso (aqueous) tops up with DMSO buffer: 0 normal, 199.6 DMSO (F18/G18)', () => {
    const [top] = result.blocks[0].rows;
    expect(top.normalBuffer_ul).toBeCloseTo(0, 12);
    expect(top.dmsoBuffer_ul).toBeCloseTo(199.6, 12);
  });

  it('Nebi (DMSO) tops up with normal buffer: 199.6 normal, 0 DMSO (N18/O18)', () => {
    const [top] = result.blocks[1].rows;
    expect(top.normalBuffer_ul).toBeCloseTo(199.6, 12);
    expect(top.dmsoBuffer_ul).toBeCloseTo(0, 12);
  });

  it('block totals match the sheet (F30/G31, N30/O31)', () => {
    expect(result.blocks[0].totalNormalBuffer_ul).toBeCloseTo(0, 12);
    expect(result.blocks[0].totalDmsoBuffer_ul).toBeCloseTo(199.6, 12);
    expect(result.blocks[1].totalNormalBuffer_ul).toBeCloseTo(199.6, 12);
    expect(result.blocks[1].totalDmsoBuffer_ul).toBeCloseTo(0, 12);
  });

  it('both vehicles land on the same DMSO fraction — the point of the exercise', () => {
    const [aq] = result.blocks[0].rows;
    const [dmso] = result.blocks[1].rows;
    expect(dmso.dmsoFraction).toBeCloseTo(0.002, 12);
    expect(aq.dmsoFraction).toBeCloseTo(0.002, 5); // 199.6 µl of buffer cannot quite fill 200
    expect(Math.abs(aq.dmsoFraction - dmso.dmsoFraction)).toBeLessThan(1e-5);
  });

  it('lower tubes are topped up entirely with DMSO buffer (G19 reduces to D − E)', () => {
    const r = computeDilutions(experiment([block({ name: 'Nebi', vehicle: 'DMSO', logM: [-5, -6] })])).blocks[0];
    const lower = r.rows[1];
    expect(lower.dmsoBuffer_ul).toBeCloseTo(lower.volToPrepare_ul - lower.aliquotIn_ul, 12);
    expect(lower.normalBuffer_ul).toBeCloseTo(0, 12);
    expect(lower.dmsoFraction).toBeCloseTo(0.002, 12);
  });
});

describe('matching rules', () => {
  it('an all-aqueous experiment needs no DMSO at all', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5, -6] })]));
    expect(r.target).toBe(0);
    expect(r.totalDmsoBuffer_ul).toBe(0);
    expect(r.blocks[0].rows.every((x) => x.dmsoBuffer_ul === 0)).toBe(true);
  });

  it('an excluded compound is never matched (the sheet\'s Terbium)', () => {
    const tb = block({ id: 'tb', name: 'Terbium', logM: [-5], excludeFromVehicleMatch: true });
    const nebi = block({ id: 'nebi', name: 'Nebi', vehicle: 'DMSO', logM: [-5] });
    const r = computeDilutions(experiment([tb, nebi]));
    expect(r.target).toBeCloseTo(0.002, 12);
    expect(r.blocks[0].unmatched).toBe(true);
    expect(r.blocks[0].totalDmsoBuffer_ul).toBe(0);
    expect(r.blocks[0].rows[0].dmsoFraction).toBe(0);
  });

  it('an excluded DMSO compound does not drag the target up', () => {
    const excluded = block({ id: 'x', name: 'odd one', vehicle: 'DMSO', stockConc_uM: 100, logM: [-5], excludeFromVehicleMatch: true });
    const nebi = block({ id: 'nebi', name: 'Nebi', vehicle: 'DMSO', logM: [-5] });
    expect(computeDmsoTarget(experiment([excluded, nebi]))).toBeCloseTo(0.002, 12);
  });

  it('the whole experiment matches the worst DMSO load, not the average', () => {
    const mild = block({ id: 'a', name: 'mild', vehicle: 'DMSO', logM: [-5] }); // 0.002
    const harsh = block({ id: 'b', name: 'harsh', vehicle: 'DMSO', stockConc_uM: 1000, logM: [-5] }); // 0.02
    expect(computeDmsoTarget(experiment([mild, harsh]))).toBeCloseTo(0.02, 12);
  });

  it('an override is honoured, and flagged when it is below what a stock brings in', () => {
    const nebi = block({ name: 'Nebi', vehicle: 'DMSO', logM: [-5] });
    const r = computeDilutions(experiment([nebi], { dmsoOverride: 0.001 }));
    expect(r.target).toBeCloseTo(0.001, 12);
    expect(r.warnings.some((w) => w.code === 'override-below-computed')).toBe(true);
  });

  it('in-well DMSO follows the addition: 10 µl into 90 µl is 10×', () => {
    const nebi = block({ name: 'Nebi', vehicle: 'DMSO', logM: [-5] });
    const r = computeDilutions(experiment([nebi], { addition: { compound_ul: 10, inWell_ul: 90 } }));
    expect(r.additionFactor).toBeCloseTo(10, 12);
    expect(r.inWellDmso).toBeCloseTo(r.target / 10, 12);
  });

  it('flags a compound added differently from the rest', () => {
    const nebi = block({ name: 'Nebi', vehicle: 'DMSO', dilutionFactorOverride: 10, logM: [-5] });
    const r = computeDilutions(experiment([nebi]));
    expect(r.warnings.some((w) => w.code === 'block-factor-override')).toBe(true);
  });
});

describe('validation', () => {
  it('catches a stock too dilute to reach the top concentration', () => {
    const r = computeDilutions(experiment([block({ name: 'weak', stockConc_uM: 5, logM: [-5] })]));
    expect(r.warnings.some((w) => w.code === 'stock-too-dilute')).toBe(true);
  });

  it('catches rows entered in the wrong order', () => {
    const r = computeDilutions(experiment([block({ name: 'muddled', logM: [-8, -5] })]));
    expect(r.warnings.some((w) => w.code === 'rows-not-descending')).toBe(true);
  });

  it('warns when an aliquot falls below the pipetting minimum', () => {
    const r = computeDilutions(experiment([block({ name: 'tiny', stockConc_uM: 1e6, logM: [-6] })]));
    expect(r.warnings.some((w) => w.code === 'aliquot-below-min-pipette')).toBe(true);
  });

  it('an empty block is inert', () => {
    const r = computeDilutions(experiment([block({ name: 'unused' })]));
    expect(r.blocks[0].isEmpty).toBe(true);
    expect(r.blocks[0].rows).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.totalNormalBuffer_ul).toBe(0);
  });
});

describe('assay types', () => {
  it('NanoBiT/BRET dilutes compounds in assay buffer and is complete on the compound side', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5] })]));
    expect(r.assay.diluent).toBe('assay buffer');
    expect(r.assay.compoundsComplete).toBe(true);
  });

  it('HiBiT uses the same compound maths but declares the substrate as outstanding', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5] })], { assayType: 'HiBiT' }));
    expect(r.assay.diluent).toBe('assay buffer');
    expect(r.assay.compoundsComplete).toBe(false);
    expect(r.assay.pending.join(' ')).toMatch(/substrate/i);
  });

  it('DERET dilutes compounds in furimazine, and says that preparation is not calculated', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5] })], { assayType: 'DERET' }));
    expect(r.assay.diluent).toBe('furimazine solution');
    expect(r.assay.pending.join(' ')).toMatch(/furimazine/i);
  });

  it('the assay type never changes a volume', () => {
    const b = [block({ name: 'Nebi', vehicle: 'DMSO', logM: [-5, -6] })];
    const bret = computeDilutions(experiment(b));
    const deret = computeDilutions(experiment(b, { assayType: 'DERET' }));
    expect(deret.blocks[0].rows).toEqual(bret.blocks[0].rows);
  });
});

/**
 * BSA carrier. The worked case: compounds NOT in BSA, every diluent prepared at 0.01 %
 * BSA from a 5 % stock.
 */
describe('BSA in the diluents', () => {
  const bsa = { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' as const };

  it('is off by default and adds nothing', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5] })]));
    expect(r.bsaBufferFraction).toBe(0);
    expect(r.recipes.every((x) => x.bsaStock_ul === 0)).toBe(true);
    expect(r.blocks[0].rows[0].bsaFraction).toBe(0);
  });

  it('0.01 % from a 5 % stock = 2 µl of stock per 1000 µl of diluent', () => {
    // one aqueous compound, 5 rows → a diluent volume in the ~1 ml range
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5, -6, -7, -8, -9] })], { bsa }));
    const normal = r.recipes[0];
    expect(normal.bsaStock_ul).toBeCloseTo((normal.prepare_ul * 0.0001 * 100) / 5, 12);
    expect(normal.bsaStock_ul / normal.prepare_ul).toBeCloseTo(0.002, 12); // 2 µl per ml
    expect(normal.base_ul + normal.bsaStock_ul + normal.dmso_ul).toBeCloseTo(normal.prepare_ul, 9);
  });

  it('a stock without BSA leaves each tube a hair under target, and says by how much', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5] })], { bsa }));
    const top = r.blocks[0].rows[0];
    // 199.6 µl of 0.01 % diluent in a 200 µl tube
    expect(top.bsaFraction).toBeCloseTo(0.0001 * (199.6 / 200), 12);
    expect(top.bsaFraction).toBeLessThan(0.0001);
  });

  it('a stock already in BSA at the same % lands exactly on target', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Iso', logM: [-5], stockBsaPct: 0.01 })], { bsa }),
    );
    expect(r.blocks[0].rows[0].bsaFraction).toBeCloseTo(0.0001, 12);
  });

  it('in every buffer, the well sits at the same % as the tubes', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', logM: [-5] })], { bsa }));
    expect(r.bsaBufferFraction).toBeCloseTo(0.0001, 12);
    expect(r.bsaInWell).toBeCloseTo(0.0001, 12);
  });

  it('in the compound only, the well lands a factor lower', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Iso', logM: [-5] })], {
        bsa: { ...bsa, placement: 'compound-only' },
        addition: { compound_ul: 10, inWell_ul: 90 },
      }),
    );
    expect(r.bsaBufferFraction).toBeCloseTo(0.0001, 12);
    expect(r.bsaInWell).toBeCloseTo(0.00001, 12);
  });

  it('BSA and DMSO share the same diluents without fighting', () => {
    const r = computeDilutions(
      experiment([
        block({ id: 'iso', name: 'Iso', logM: [-5] }),
        block({ id: 'nebi', name: 'Nebi', vehicle: 'DMSO', logM: [-5] }),
      ], { bsa }),
    );
    const dmsoDiluent = r.recipes[1];
    expect(dmsoDiluent.dmso_ul).toBeCloseTo(dmsoDiluent.prepare_ul * 0.002, 12);
    expect(dmsoDiluent.bsaStock_ul).toBeCloseTo((dmsoDiluent.prepare_ul * 0.0001 * 100) / 5, 12);
    expect(dmsoDiluent.base_ul).toBeCloseTo(
      dmsoDiluent.prepare_ul - dmsoDiluent.dmso_ul - dmsoDiluent.bsaStock_ul,
      9,
    );
    // the DMSO numbers are untouched by adding BSA
    expect(r.target).toBeCloseTo(0.002, 12);
    expect(r.blocks[0].rows[0].dmsoBuffer_ul).toBeCloseTo(199.6, 12);
  });

  it('refuses a BSA stock weaker than the target', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Iso', logM: [-5] })], { bsa: { ...bsa, targetPct: 10 } }),
    );
    expect(r.warnings.some((w) => w.code === 'bsa-stock-too-weak')).toBe(true);
  });

  it('makes more diluent rather than ask for an unpipettable BSA volume, and says so', () => {
    const r = computeDilutions(experiment([block({ name: 'Iso', volForWells_ul: 20, logM: [-5] })], { bsa }));
    const normal = r.recipes[0];
    expect(normal.scaledUpFor).toContain('BSA');
    expect(normal.bsaStock_ul).toBeGreaterThanOrEqual(0.5);
    expect(normal.prepare_ul).toBeGreaterThan(normal.required_ul);
    const note = r.warnings.find((w) => w.code === 'premix-scaled-up');
    expect(note?.level).toBe('info');
    expect(note?.message).toMatch(/pipetting minimum/);
  });
});

describe('premix volumes', () => {
  const bsa = { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' as const };

  it('rounds up to a volume someone would actually measure out', () => {
    expect(roundUpPremix(0)).toBe(0);
    expect(roundUpPremix(12)).toBe(20);
    expect(roundUpPremix(100)).toBe(100);
    expect(roundUpPremix(822.11)).toBe(850);
    expect(roundUpPremix(2983.754)).toBe(3000);
    expect(roundUpPremix(7200)).toBe(7500);
  });

  it('never prepares less than the compounds consume', () => {
    const r = computeDilutions(
      experiment([
        block({ id: 'a', name: 'Iso', logM: [-5, -6, -7] }),
        block({ id: 'b', name: 'Nebi', vehicle: 'DMSO', logM: [-5, -6, -7] }),
      ], { bsa }),
    );
    for (const x of r.recipes) {
      expect(x.prepare_ul).toBeGreaterThanOrEqual(x.required_ul);
      expect(x.base_ul + x.dmso_ul + x.bsaStock_ul).toBeCloseTo(x.prepare_ul, 9);
    }
  });

  it('every additive it asks for is pipettable', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Nebi', vehicle: 'DMSO', volForWells_ul: 20, logM: [-5] })], { bsa }),
    );
    for (const x of r.recipes) {
      if (x.dmso_ul > 0) expect(x.dmso_ul).toBeGreaterThanOrEqual(0.5);
      if (x.bsaStock_ul > 0) expect(x.bsaStock_ul).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('where the DMSO sits', () => {
  const nebi = block({ name: 'Nebi', vehicle: 'DMSO', logM: [-5, -6] });

  it('compound only: the well buffer is DMSO-free and the well lands a factor lower', () => {
    const r = computeDilutions(
      experiment([nebi], { addition: { compound_ul: 10, inWell_ul: 90 }, dmsoPlacement: 'compound-only' }),
    );
    expect(r.inWellDmso).toBeCloseTo(r.target / 10, 12);
    expect(r.recipes[2].dmso_ul).toBe(0);
  });

  it('every buffer: the well buffer carries the same DMSO, so nothing changes on addition', () => {
    const r = computeDilutions(
      experiment([nebi], { addition: { compound_ul: 10, inWell_ul: 90 }, dmsoPlacement: 'all-buffers' }),
    );
    expect(r.inWellDmso).toBeCloseTo(r.target, 12);
    const wellBuffer = r.recipes[2];
    expect(wellBuffer.dmso_ul).toBeCloseTo(wellBuffer.prepare_ul * r.target, 9);
  });

  it('the well buffer is sized from the addition: 90 µl per 10 µl of compound', () => {
    const r = computeDilutions(
      experiment([block({ name: 'Iso', volForWells_ul: 200, logM: [-5, -6] })], {
        addition: { compound_ul: 10, inWell_ul: 90 },
      }),
    );
    // two rows × 200 µl × margin 1 × (90/10)
    expect(r.recipes[2].required_ul).toBeCloseTo(2 * 200 * 9, 9);
  });

  it('neither placement changes a tube volume', () => {
    const a = computeDilutions(experiment([nebi], { dmsoPlacement: 'compound-only' }));
    const b = computeDilutions(experiment([nebi], { dmsoPlacement: 'all-buffers' }));
    expect(b.blocks[0].rows).toEqual(a.blocks[0].rows);
  });
});
