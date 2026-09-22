import { describe, expect, it } from 'vitest';
import { defaultFluorescein, defaultTb } from '../deret';
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

  it('volume is per-well × wells + the extra, and the stock follows the prepared dilution', () => {
    const r = computeSubstrate(bret({ wells: 96, extraVolume_ul: 192 }), WELL);
    expect(r.required_ul).toBeCloseTo(10 * 96 + 192, 9); // 1152 µl
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
  /** 50 µl of substrate added to 50 µl of buffer. */
  const hibitWell = { assayBuffer_ul: 50, compound_ul: 10, prepare_ul: 5000 };

  it('defaults to 50 µl/well: substrate 1:100 and LgBiT 1:200, in the well', () => {
    expect(hibit.volumePerWell_ul).toBe(50);
    expect(hibit.components.map((c) => c.dilution)).toEqual([100, 200]);
  });

  it('counts those dilutions before the compounds go in', () => {
    expect(hibit.reference).toBe('before-compounds');
    // (50 buffer + 50 substrate) / 50 — the compound's 10 µl does not count
    expect(substrateFold(hibit, hibitWell)).toBeCloseTo(2, 12);
    const r = computeSubstrate(hibit, hibitWell);
    expect(r.components[0].preparedDilution).toBeCloseTo(50, 12);
    expect(r.components[1].preparedDilution).toBeCloseTo(100, 12);
    expect(r.components[0].stock_ul).toBeCloseTo(100, 12); // 5000 / 50
    expect(r.components[1].stock_ul).toBeCloseTo(50, 12); //  5000 / 100
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
    vehicle: 'DMSO', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '',
  };
  const exp = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'NanoBiT/BRET',
    dmsoOverride: null,
    addition: { compound_ul: 10, assayBuffer_ul: 80 },
    dmsoPlacement: 'compound-only',
    wellBufferExtra_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: defaultSubstrate('NanoBiT/BRET'),
    blocks: [block],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    fluorescein: { ...defaultFluorescein(), enabled: false },
    tb: { ...defaultTb(), enabled: false },
    bufferNotes: '',
    ...over,
  });

  it('adds a substrate premix listing each component as an ingredient', () => {
    const r = computeDilutions(exp());
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    expect(sub.required_ul).toBeCloseTo(10 * 96 + defaultSubstrate('NanoBiT/BRET').extraVolume_ul, 9);
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
    wellBufferExtra_ul: 0,
        bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
      }),
    );
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    // it starts from the ready-made buffer, which already carries both
    expect(sub.fromReadyBuffer).toBe(true);
    expect(sub.baseName).toMatch(/batch/);
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
    wellBufferExtra_ul: 0,
        bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
      }),
    );
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    // everything added — substrate stocks, and the DMSO this diluent needs — displaces
    // carrier-bearing buffer, so BSA lands in proportion to the buffer left
    expect(sub.achievedBsa).toBeCloseTo(0.0001 * (sub.base_ul / sub.prepare_ul), 9);
    expect(sub.achievedBsa).toBeLessThan(0.0001);
    expect(sub.correctedFor).toEqual([]);
    // only the carried additive falls short; DMSO is pipetted in for the full volume
    expect(sub.leftShortFor.map((x) => x.name)).toEqual(['BSA']);
    expect(sub.achievedDmso).toBeCloseTo(r.target, 9);
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
    wellBufferExtra_ul: 0,
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

describe('premix presentation', () => {
  const blocks: CompoundBlock[] = [
    { id: 'b', name: 'Nebi', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
      vehicle: 'DMSO', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '' },
  ];
  const base = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'NanoBiT/BRET',
    dmsoOverride: null,
    addition: { compound_ul: 10, assayBuffer_ul: 80 },
    dmsoPlacement: 'compound-only',
    wellBufferExtra_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: defaultSubstrate('NanoBiT/BRET'),
    blocks,
    bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    fluorescein: { ...defaultFluorescein(), enabled: false },
    tb: { ...defaultTb(), enabled: false },
    bufferNotes: '',
    ...over,
  });

  it('names a buffer by what is in it, never just "assay buffer"', () => {
    const r = computeDilutions(base());
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    expect(batch.name).toMatch(/0\.01 % BSA/);
    expect(batch.baseName).toBe('plain assay buffer');
    expect(r.recipes.find((x) => x.id === 'substrate')!.baseName).toMatch(/0\.01 % BSA/);
  });

  it('a portion poured off the batch is an allocation, not another preparation', () => {
    const r = computeDilutions(base());
    const well = r.recipes.find((x) => x.id === 'well')!;
    expect(well.isPlainDraw).toBe(true);
    // the DMSO diluent has DMSO added, so it is a preparation
    expect(r.recipes.find((x) => x.id === 'dmso')!.isPlainDraw).toBe(false);
    // and the substrate has its own stocks
    expect(r.recipes.find((x) => x.id === 'substrate')!.isPlainDraw).toBe(false);
  });

  it('the batch covers every portion drawn from it', () => {
    const r = computeDilutions(base());
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    const drawn = r.recipes.filter((x) => x.fromReadyBuffer).reduce((a, x) => a + x.base_ul, 0);
    expect(batch.prepare_ul).toBeGreaterThanOrEqual(drawn);
  });

  it('BSA only in the compounds: the batch is plain and the compound diluents add their own', () => {
    const r = computeDilutions(base({ bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'compound-only' } }));
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    expect(batch.name).toMatch(/plain assay buffer/i);
    const well = r.recipes.find((x) => x.id === 'well')!;
    expect(well.isPlainDraw).toBe(true); // just a portion of the plain batch
    expect(well.achievedBsa).toBe(0);
    const normal = r.recipes.find((x) => x.id === 'normal')!;
    expect(normal.bsaStock_ul).toBeGreaterThan(0); // BSA added here instead
    expect(normal.achievedBsa).toBeCloseTo(0.0001, 9);
  });
});

describe('plain buffer is not a preparation', () => {
  const blocks: CompoundBlock[] = [
    { id: 'b', name: 'Iso', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
      vehicle: 'aqueous', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '' },
  ];
  const plain = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'NanoBiT/BRET',
    dmsoOverride: null,
    addition: { compound_ul: 10, assayBuffer_ul: 80 },
    dmsoPlacement: 'compound-only',
    wellBufferExtra_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false },
    blocks,
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    fluorescein: { ...defaultFluorescein(), enabled: false },
    tb: { ...defaultTb(), enabled: false },
    bufferNotes: '',
    ...over,
  });

  it('an all-aqueous run with no BSA has nothing to premix at all', () => {
    const r = computeDilutions(plain());
    expect(r.recipes.every((x) => x.isPlainBuffer)).toBe(true);
    expect(r.plainBuffer_ul).toBeGreaterThan(0);
  });

  it('what comes off the shelf is counted once, not once per portion', () => {
    const r = computeDilutions(plain());
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    // the batch is the only thing built from the bottle; the rest are drawn from it
    expect(r.plainBuffer_ul).toBeCloseTo(batch.base_ul, 9);
    expect(r.recipes.filter((x) => !x.fromReadyBuffer)).toHaveLength(1);
  });

  it('with BSA, the batch becomes a real preparation and the bottle figure is its base', () => {
    const r = computeDilutions(plain({ bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' } }));
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    expect(batch.isPlainBuffer).toBe(false);
    expect(batch.bsaStock_ul).toBeGreaterThan(0);
    expect(r.plainBuffer_ul).toBeCloseTo(batch.base_ul, 9);
    // the compound diluent is then a portion of that batch, not plain buffer
    expect(r.recipes.find((x) => x.id === 'normal')!.isPlainBuffer).toBe(false);
  });

  it('a DMSO diluent is always a preparation, BSA or no BSA', () => {
    const withDmso = computeDilutions(plain({
      blocks: [{ ...blocks[0], vehicle: 'DMSO' }],
    }));
    expect(withDmso.recipes.find((x) => x.id === 'dmso')!.isPlainBuffer).toBe(false);
    expect(withDmso.recipes.find((x) => x.id === 'normal')!.isPlainBuffer).toBe(true);
  });
});
