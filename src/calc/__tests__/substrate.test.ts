import { describe, expect, it } from 'vitest';
import { computeSubstrate, defaultSubstrate, substrateFold, type SubstrateSettings } from '../substrate';
import { computeDilutions, type CompoundBlock, type DilutionExperiment } from '../dilutions';

/** The worked BRET setup: 80 µl assay buffer + 10 µl substrate + 10 µl compound. */
const WELL = { assayBuffer_ul: 80, compound_ul: 10, prepare_ul: 1000 };

const bret = (over: Partial<SubstrateSettings> = {}): SubstrateSettings => ({
  ...defaultSubstrate('NanoBiT/BRET'),
  ...over,
});

describe('BRET / NanoBiT substrate', () => {
  it('a 1:1000 in-well substrate is prepared at 1:100 when referenced after the compounds', () => {
    const r = computeSubstrate(bret(), WELL);
    expect(r.foldFactor).toBeCloseTo(10, 12); // (80 + 10 + 10) / 10
    const [c] = r.components;
    expect(c.preparedDilution).toBeCloseTo(100, 12);
    expect(c.inWellDilution).toBeCloseTo(1000, 12);
  });

  it('referenced before the compounds, the same 1:1000 needs 1:111 — the 9× case', () => {
    const r = computeSubstrate(bret({ reference: 'before-compounds' }), WELL);
    expect(r.foldFactor).toBeCloseTo(9, 12); // (80 + 10) / 10
    expect(r.components[0].preparedDilution).toBeCloseTo(1000 / 9, 12);
  });

  it('volume is per-well × wells × margin, and the stock follows the prepared dilution', () => {
    const r = computeSubstrate(bret({ wells: 96, margin: 1.2 }), WELL);
    expect(r.required_ul).toBeCloseTo(10 * 96 * 1.2, 9); // 1152 µl
    // 1000 µl of a 1:100 solution takes 10 µl of stock
    expect(r.components[0].stock_ul).toBeCloseTo(10, 12);
  });

  it('reports the assay buffer left in the well once the substrate has its share', () => {
    expect(computeSubstrate(bret(), WELL).assayBufferPerWell_ul).toBe(80);
  });

  it('an empty well is legal: 50 µl of substrate into nothing is 1× on its own', () => {
    const r = computeSubstrate(bret({ volumePerWell_ul: 50 }), { assayBuffer_ul: 0, compound_ul: 0, prepare_ul: 1000 });
    expect(r.foldFactor).toBe(1);
    expect(r.components[0].preparedDilution).toBeCloseTo(1000, 12);
  });

  it('catches a "dilution" that is not one', () => {
    const r = computeSubstrate(bret({ components: [{ id: 'c', name: 'x', dilution: 1, notes: '' }] }), WELL);
    expect(r.warnings.some((w) => w.code === 'substrate-dilution')).toBe(true);
  });

  it('warns when a component stock volume is too small to pipette', () => {
    const r = computeSubstrate(bret(), { ...WELL, prepare_ul: 20 }); // 20/100 = 0.2 µl
    expect(r.warnings.some((w) => w.code === 'substrate-below-min-pipette')).toBe(true);
  });
});

describe('HiBiT substrate', () => {
  const hibit = defaultSubstrate('HiBiT');
  /** 50 µl of reagent added to 50 µl of buffer — the kit's equal-volume addition. */
  const hibitWell = { assayBuffer_ul: 50, compound_ul: 0, prepare_ul: 5000 };

  it('defaults to 50 µl/well, quoted in the well: substrate 1:200, LgBiT 1:400', () => {
    expect(hibit.volumePerWell_ul).toBe(50);
    expect(hibit.components.map((c) => c.dilution)).toEqual([200, 400]);
  });

  it('an equal-volume addition is 2×, so the reagent is the kit\'s 1:100 and 1:200', () => {
    expect(substrateFold(hibit, hibitWell)).toBeCloseTo(2, 12);
    const r = computeSubstrate(hibit, hibitWell);
    expect(r.components[0].preparedDilution).toBeCloseTo(100, 12);
    expect(r.components[1].preparedDilution).toBeCloseTo(200, 12);
    expect(r.components[0].stock_ul).toBeCloseTo(50, 12); // 5000 / 100
    expect(r.components[1].stock_ul).toBeCloseTo(25, 12); // 5000 / 200
  });
});

describe('DERET substrate', () => {
  it('is off by default — furimazine is the compound diluent and is not calculated yet', () => {
    expect(defaultSubstrate('DERET').enabled).toBe(false);
  });
});

describe('substrate inside the experiment', () => {
  const block: CompoundBlock = {
    id: 'b', name: 'Iso', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
    vehicle: 'DMSO', margin: 1, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '',
  };
  const exp = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'NanoBiT/BRET',
    dmsoOverride: null,
    addition: { compound_ul: 10, assayBuffer_ul: 80 },
    dmsoPlacement: 'compound-only',
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: defaultSubstrate('NanoBiT/BRET'),
    blocks: [block],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    bufferNotes: '',
    ...over,
  });

  it('adds a substrate premix listing each component as an ingredient', () => {
    const r = computeDilutions(exp());
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    expect(sub.required_ul).toBeCloseTo(10 * 96 * 1.2, 9);
    expect(sub.components[0].name).toMatch(/1:100/);
    expect(sub.components[0].volume_ul).toBeCloseTo(sub.prepare_ul / 100, 9);
    expect(sub.base_ul).toBeCloseTo(sub.prepare_ul - sub.components[0].volume_ul, 9);
  });

  it('the plain well buffer is its own volume, and the substrate adds to the total', () => {
    const withSub = computeDilutions(exp());
    const without = computeDilutions(exp({ substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false } }));
    const wellOf = (x: typeof withSub) => x.recipes.find((r) => r.id === 'well')!.required_ul;
    // the buffer per well (80 µl) does not change; only the total, and so the fold, does
    expect(wellOf(withSub)).toBeCloseTo(wellOf(without), 9);
    expect(withSub.additionFactor).toBeCloseTo(10, 12); // (80 + 10 + 10) / 10
    expect(without.additionFactor).toBeCloseTo(9, 12); //  (80 + 10) / 10
  });

  it('prepares the substrate in the same buffer as the well: BSA and DMSO follow placement', () => {
    const r = computeDilutions(
      exp({
        dmsoPlacement: 'all-buffers',
        bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
      }),
    );
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    // it starts from the ready-made buffer, which already carries both
    expect(sub.fromReadyBuffer).toBe(true);
    expect(sub.baseName).toMatch(/ready-made/);
    // within the noise floor of target, the substrate stock having displaced ~1 %
    expect(Math.abs(1 - sub.achievedDmso / r.target)).toBeLessThan(0.02);
    expect(Math.abs(1 - sub.achievedBsa / 0.0001)).toBeLessThan(0.02);
    expect(sub.base_ul).toBeCloseTo(
      sub.prepare_ul - sub.dmso_ul - sub.bsaStock_ul - sub.components[0].volume_ul,
      9,
    );
  });

  it('the substrate stocks displace carrier, which is reported and left alone when tiny', () => {
    const r = computeDilutions(
      exp({
        dmsoPlacement: 'all-buffers',
        bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
      }),
    );
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    const componentFraction = sub.components[0].volume_ul / sub.prepare_ul;
    // 1 % of the volume is substrate stock, so the carrier lands 1 % low — inside the noise
    expect(sub.achievedBsa).toBeCloseTo(0.0001 * (1 - componentFraction), 9);
    expect(sub.correctedFor).toEqual([]);
    expect(sub.leftShortFor.map((x) => x.name).sort()).toEqual(['BSA', 'DMSO']);
    expect(r.warnings.some((w) => w.code === 'carrier-left-short')).toBe(true);
  });

  it('a big enough displacement is topped up instead', () => {
    // a substrate at 1:10 in the well takes a tenth of the solution, far past the noise floor
    const heavy = {
      ...defaultSubstrate('NanoBiT/BRET'),
      components: [{ id: 'c', name: 'concentrated reagent', dilution: 10, notes: '' }],
    };
    const r = computeDilutions(
      exp({
        substrate: heavy,
        dmsoPlacement: 'all-buffers',
        bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
      }),
    );
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    expect(sub.correctedFor.length).toBeGreaterThan(0);
    expect(sub.achievedDmso).toBeCloseTo(r.target, 6);
    expect(r.warnings.some((w) => w.code === 'carrier-topped-up')).toBe(true);
  });

  it('carries no DMSO when the well buffer carries none', () => {
    const r = computeDilutions(exp({ dmsoPlacement: 'compound-only' }));
    expect(r.recipes.find((x) => x.id === 'substrate')!.dmso_ul).toBe(0);
  });

  it('disabling the substrate removes its premix entirely', () => {
    const r = computeDilutions(exp({ substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false } }));
    expect(r.recipes.some((x) => x.id === 'substrate')).toBe(false);
  });

  it('the premix volume can be overridden like any other', () => {
    const r = computeDilutions(exp({ premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: 2000 } }));
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    expect(sub.prepare_ul).toBe(2000);
    expect(sub.components[0].volume_ul).toBeCloseTo(20, 9); // 2000 / 100
  });
});
