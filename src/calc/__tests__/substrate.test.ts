import { describe, expect, it } from 'vitest';
import { computeSubstrate, defaultSubstrate, substrateFold, type SubstrateSettings } from '../substrate';
import { computeDilutions, type CompoundBlock, type DilutionExperiment } from '../dilutions';

/** The worked BRET setup: 80 µl assay buffer + 10 µl substrate + 10 µl compound. */
const WELL = { inWell_ul: 90, compound_ul: 10, prepare_ul: 1000 };

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

  it('the prepared basis works the other way round: 1:100 prepared → 1:1000 in the well', () => {
    const r = computeSubstrate(bret({ basis: 'prepared', components: [{ id: 'c', name: 'furimazine', dilution: 100, notes: '' }] }), WELL);
    expect(r.components[0].preparedDilution).toBe(100);
    expect(r.components[0].inWellDilution).toBeCloseTo(1000, 12);
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

  it('catches a substrate that does not fit in the well', () => {
    const r = computeSubstrate(bret({ volumePerWell_ul: 200 }), WELL);
    expect(r.warnings.some((w) => w.code === 'substrate-exceeds-well')).toBe(true);
  });

  it('catches a "dilution" that is not one', () => {
    const r = computeSubstrate(bret({ basis: 'prepared', components: [{ id: 'c', name: 'x', dilution: 1, notes: '' }] }), WELL);
    expect(r.warnings.some((w) => w.code === 'substrate-dilution')).toBe(true);
  });

  it('warns when a component stock volume is too small to pipette', () => {
    const r = computeSubstrate(bret(), { ...WELL, prepare_ul: 20 }); // 20/100 = 0.2 µl
    expect(r.warnings.some((w) => w.code === 'substrate-below-min-pipette')).toBe(true);
  });
});

describe('HiBiT substrate', () => {
  const hibit = defaultSubstrate('HiBiT');

  it('defaults to 50 µl/well of the kit recipe: substrate 1:100, LgBiT 1:200', () => {
    expect(hibit.volumePerWell_ul).toBe(50);
    expect(hibit.components.map((c) => c.dilution)).toEqual([100, 200]);
  });

  it('is used as prepared, so no in-well dilution is claimed', () => {
    const r = computeSubstrate(hibit, { inWell_ul: 50, compound_ul: 0, prepare_ul: 5000 });
    expect(substrateFold(hibit, { inWell_ul: 50, compound_ul: 0, prepare_ul: 0 })).toBeNull();
    expect(r.foldFactor).toBeNull();
    expect(r.components.every((c) => c.inWellDilution === null)).toBe(true);
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
    addition: { compound_ul: 10, inWell_ul: 90 },
    dmsoPlacement: 'compound-only',
    premixOverrides: { normal: null, dmso: null, well: null, substrate: null },
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

  it('takes the substrate volume out of the plain well buffer', () => {
    const withSub = computeDilutions(exp());
    const without = computeDilutions(exp({ substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false } }));
    const wellOf = (x: typeof withSub) => x.recipes.find((r) => r.id === 'well')!.required_ul;
    // 80 µl of buffer per well instead of 90
    expect(wellOf(withSub)).toBeCloseTo((wellOf(without) * 80) / 90, 9);
  });

  it('prepares the substrate in the same buffer as the well: BSA and DMSO follow placement', () => {
    const r = computeDilutions(
      exp({
        dmsoPlacement: 'all-buffers',
        bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
      }),
    );
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    expect(sub.dmso_ul).toBeCloseTo(sub.prepare_ul * r.target, 9);
    expect(sub.bsaStock_ul).toBeCloseTo((sub.prepare_ul * 0.0001 * 100) / 5, 9);
    expect(sub.base_ul).toBeCloseTo(
      sub.prepare_ul - sub.dmso_ul - sub.bsaStock_ul - sub.components[0].volume_ul,
      9,
    );
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
    const r = computeDilutions(exp({ premixOverrides: { normal: null, dmso: null, well: null, substrate: 2000 } }));
    const sub = r.recipes.find((x) => x.id === 'substrate')!;
    expect(sub.prepare_ul).toBe(2000);
    expect(sub.components[0].volume_ul).toBeCloseTo(20, 9); // 2000 / 100
  });
});
