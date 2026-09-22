import { describe, expect, it } from 'vitest';
import { computeFluorescein, computeTb, defaultFluorescein, defaultTb } from '../deret';
import { computeDilutions, type CompoundBlock, type DilutionExperiment } from '../dilutions';
import { defaultSubstrate } from '../substrate';

describe('fluorescein chain', () => {
  const f = defaultFluorescein();

  it('defaults to 50 µM in the buffer, from a 1 mM intermediate, from the 100 mM stock', () => {
    expect(f.target_uM).toBe(50);
    expect(f.intermediate_uM).toBe(1000);
    expect(f.stock_uM).toBe(100000);
  });

  it('1 mM → 50 µM is a 1:20 dilution into the buffer', () => {
    const r = computeFluorescein(f, 2000);
    expect(r.intoBuffer!.fold).toBeCloseTo(20, 12);
    expect(r.intoBuffer!.stock_ul).toBeCloseTo(100, 12); // 2000 / 20
    expect(r.intoBuffer!.diluent_ul).toBeCloseTo(1900, 12);
    expect(r.volumeFractionOfBuffer).toBeCloseTo(0.05, 12);
  });

  it('100 mM → 1 mM is a 1:100 dilution, sized to what the buffer takes plus the extra', () => {
    const r = computeFluorescein(f, 2000);
    // 100 µl needed for the buffer, + 20 µl extra = 120 µl of intermediate
    expect(r.intermediate!.prepare_ul).toBeCloseTo(120, 12);
    expect(r.intermediate!.fold).toBeCloseTo(100, 12);
    expect(r.intermediate!.stock_ul).toBeCloseTo(1.2, 12);
    expect(r.intermediate!.diluent_ul).toBeCloseTo(118.8, 12);
  });

  it('a higher working concentration takes proportionally more', () => {
    const r = computeFluorescein({ ...f, target_uM: 100 }, 2000);
    expect(r.intoBuffer!.stock_ul).toBeCloseTo(200, 12); // 1:10
  });

  it('rejects a chain that does not go downwards', () => {
    const bad = computeFluorescein({ ...f, intermediate_uM: 10 }, 2000);
    expect(bad.warnings.some((w) => w.code === 'fluorescein-chain')).toBe(true);
    const worse = computeFluorescein({ ...f, stock_uM: 100 }, 2000);
    expect(worse.warnings.some((w) => w.code === 'fluorescein-stock')).toBe(true);
  });

  it('warns when a step asks for less than can be pipetted', () => {
    const r = computeFluorescein(f, 100); // 5 µl into buffer, 0.25 µl of stock
    expect(r.warnings.some((w) => w.code === 'fluorescein-below-min-pipette')).toBe(true);
  });

  it('is inert when switched off', () => {
    const r = computeFluorescein({ ...f, enabled: false }, 2000);
    expect(r.intoBuffer).toBeNull();
    expect(r.volumeFractionOfBuffer).toBe(0);
  });
});

describe('terbium labelling', () => {
  const tb = defaultTb();

  it('defaults to 50 µl/well at 1:1000, plus an extra amount', () => {
    expect(tb.volumePerWell_ul).toBe(50);
    expect(tb.dilution).toBe(1000);
    const r = computeTb({ ...tb, wells: 96, extraVolume_ul: 100 });
    expect(r.required_ul).toBe(50 * 96 + 100); // 4900 µl
    expect(r.stock_ul).toBeCloseTo(4.9, 12);
    expect(r.diluent_ul).toBeCloseTo(4895.1, 12);
  });

  it('warns when the stock volume falls under the pipetting minimum', () => {
    const r = computeTb({ ...tb, wells: 8, extraVolume_ul: 0 }); // 400 µl → 0.4 µl of stock
    expect(r.warnings.some((w) => w.code === 'tb-below-min-pipette')).toBe(true);
  });

  it('rejects a dilution that is not one', () => {
    expect(computeTb({ ...tb, dilution: 1 }).warnings.some((w) => w.code === 'tb-dilution')).toBe(true);
  });
});

describe('DERET inside the experiment', () => {
  const block: CompoundBlock = {
    id: 'b', name: 'Iso', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
    vehicle: 'DMSO', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '',
  };
  const exp = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'DERET',
    dmsoOverride: null,
    // 50 µl of fluorescein buffer on the cells, then 50 µl of compound in the same buffer
    addition: { compound_ul: 50, assayBuffer_ul: 50 },
    dmsoPlacement: 'all-buffers',
    wells: null,
  wellBufferExtra_ul: 0,
  vehicleChannel_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: { ...defaultSubstrate('DERET'), enabled: false },
    fluorescein: defaultFluorescein(),
    tb: defaultTb(),
    blocks: [block],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    bufferNotes: '',
    ...over,
  });

  it('names the batch after what it carries, and keeps its own base plain', () => {
    const r = computeDilutions(exp());
    expect(r.assay.diluent).toBe('assay buffer'); // the base liquid
    expect(r.assay.compoundsComplete).toBe(true);
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    expect(batch.name).toMatch(/50 µM fluorescein/);
    expect(batch.baseName).toBe('plain assay buffer'); // what you pour the fluorescein into
    const dmso = r.recipes.find((x) => x.id === 'dmso');
    if (dmso && dmso.required_ul > 0) expect(dmso.baseName).toMatch(/50 µM fluorescein/);
  });

  it('puts the fluorescein into the batch every other diluent comes from', () => {
    const r = computeDilutions(exp());
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    const fluo = batch.components.find((c) => c.name.startsWith('Fluorescein'))!;
    expect(fluo.volume_ul).toBeCloseTo(batch.prepare_ul / 20, 9); // 1 mM → 50 µM
    expect(batch.isPlainBuffer).toBe(false);
    expect(r.fluorescein.intoBuffer!.prepare_ul).toBe(batch.prepare_ul);
  });

  it('so the compounds arrive in the same fluorescein the cells are already in', () => {
    const r = computeDilutions(exp());
    for (const id of ['normal', 'dmso', 'well'] as const) {
      const rec = r.recipes.find((x) => x.id === id);
      if (rec && rec.required_ul > 0) expect(rec.fromReadyBuffer).toBe(true);
    }
  });

  it('sizes the terbium from the wells it labels, not from the assay volumes', () => {
    const r = computeDilutions(exp({ tb: { ...defaultTb(), wells: 48 } }));
    expect(r.tb.required_ul).toBe(50 * 48 + 100);
    expect(r.tb.stock_ul).toBeCloseTo(2.5, 12);
  });

  it('leaves terbium out of the well composition — it is washed off before the assay', () => {
    const withTb = computeDilutions(exp());
    const withoutTb = computeDilutions(exp({ tb: { ...defaultTb(), enabled: false } }));
    expect(withTb.additionFactor).toBe(withoutTb.additionFactor);
    expect(withTb.blocks[0].rows).toEqual(withoutTb.blocks[0].rows);
  });

  it('neither fluorescein nor Tb applies to the other assays', () => {
    const bret = computeDilutions(exp({ assayType: 'NanoBiT/BRET' }));
    expect(bret.fluorescein.enabled).toBe(false);
    expect(bret.tb.enabled).toBe(false);
    expect(bret.recipes.find((x) => x.id === 'assay-buffer')?.components ?? []).toHaveLength(0);
  });

  it('DMSO and BSA placement still apply on top of the fluorescein buffer', () => {
    const r = computeDilutions(exp({
      bsa: { enabled: true, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    }));
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    expect(batch.bsaStock_ul).toBeGreaterThan(0);
    expect(batch.components.some((c) => c.name.startsWith('Fluorescein'))).toBe(true);
    // the fluorescein displaces carrier like any other stock, and that is accounted for
    expect(batch.achievedBsa).toBeGreaterThan(0);
  });
});

describe('what sizes the buffer', () => {
  const block: CompoundBlock = {
    id: 'b', name: 'Iso', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
    vehicle: 'aqueous', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '',
  };
  const exp = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'DERET',
    dmsoOverride: null,
    addition: { compound_ul: 50, assayBuffer_ul: 50 },
    dmsoPlacement: 'all-buffers',
    wells: null,
  wellBufferExtra_ul: 0,
  vehicleChannel_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: { ...defaultSubstrate('DERET'), enabled: false },
    fluorescein: defaultFluorescein(),
    tb: defaultTb(),
    blocks: [block],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    bufferNotes: '',
    ...over,
  });

  it('the well count falls out of the series, it is never typed', () => {
    // 2 rows × 200 µl, 50 µl into each well → 8 wells
    expect(computeDilutions(exp()).wellsCovered).toBeCloseTo(8, 9);
  });

  it('buffer-only wells are added as a volume, and the fluorescein follows', () => {
    const plain = computeDilutions(exp());
    const withControls = computeDilutions(exp({ wellBufferExtra_ul: 2000 }));
    const wellOf = (r: typeof plain) => r.recipes.find((x) => x.id === 'well')!.required_ul;
    expect(wellOf(withControls)).toBeCloseTo(wellOf(plain) + 2000, 9);
    // a bigger batch takes proportionally more fluorescein
    expect(withControls.fluorescein.intoBuffer!.stock_ul).toBeGreaterThan(plain.fluorescein.intoBuffer!.stock_ul);
    expect(withControls.fluorescein.volumeFractionOfBuffer).toBeCloseTo(plain.fluorescein.volumeFractionOfBuffer, 9);
  });

  it('the fluorescein covers the compound side and the wells together', () => {
    const r = computeDilutions(exp({ wellBufferExtra_ul: 500 }));
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    const drawn = r.recipes.filter((x) => x.fromReadyBuffer).reduce((a, x) => a + x.base_ul, 0);
    expect(batch.prepare_ul).toBeGreaterThanOrEqual(drawn);
    expect(r.fluorescein.intoBuffer!.prepare_ul).toBe(batch.prepare_ul);
  });

  it('changing the Tb well count does not touch the fluorescein', () => {
    const a = computeDilutions(exp());
    const b = computeDilutions(exp({ tb: { ...defaultTb(), wells: 384 } }));
    expect(b.fluorescein.intoBuffer!.stock_ul).toBeCloseTo(a.fluorescein.intoBuffer!.stock_ul, 9);
    expect(b.tb.required_ul).toBeGreaterThan(a.tb.required_ul);
  });

  it('DERET never prepares a substrate, even if one was left switched on', () => {
    const r = computeDilutions(exp({ substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: true } }));
    expect(r.substrate.enabled).toBe(false);
    expect(r.recipes.some((x) => x.id === 'substrate')).toBe(false);
  });
});

describe('a substrate left switched on cannot leak into DERET', () => {
  const block: CompoundBlock = {
    id: 'b', name: 'Iso', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
    vehicle: 'aqueous', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5], stockBsaPct: null, notes: '',
  };
  const exp = (assayType: 'DERET' | 'NanoBiT/BRET'): DilutionExperiment => ({
    assayType,
    dmsoOverride: null,
    addition: { compound_ul: 10, assayBuffer_ul: 80 },
    dmsoPlacement: 'compound-only',
    wells: null,
  wellBufferExtra_ul: 0,
  vehicleChannel_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    // 50 µl/well, as if HiBiT defaults had been loaded before switching to DERET
    substrate: { ...defaultSubstrate('HiBiT'), enabled: true },
    fluorescein: defaultFluorescein(),
    tb: defaultTb(),
    blocks: [block],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    bufferNotes: '',
  });

  it('leaves the well volume and the addition factor alone', () => {
    const deret = computeDilutions(exp('DERET'));
    // 80 µl buffer + 10 µl compound only — the 50 µl substrate does not exist here
    expect(deret.additionFactor).toBeCloseTo(9, 12);
    expect(deret.substrate.enabled).toBe(false);
    // the same experiment as NanoBiT/BRET does count it: (80 + 50 + 10) / 10
    expect(computeDilutions(exp('NanoBiT/BRET')).additionFactor).toBeCloseTo(14, 12);
  });

  it('keeps it out of the premixes and the tubes', () => {
    const deret = computeDilutions(exp('DERET'));
    expect(deret.recipes.some((r) => r.id === 'substrate')).toBe(false);
    expect(deret.blocks[0].rows[0].tubeConc_uM).toBeCloseTo(10 * 9, 9);
  });
});

describe('sizing the buffer by the plate, and the vehicle channel', () => {
  const block: CompoundBlock = {
    id: 'b', name: 'Nebi', volForWells_ul: 200, dilutionFactorOverride: null, stockConc_uM: 10000,
    vehicle: 'DMSO', extraVolume_ul: 0, excludeFromVehicleMatch: false, logM: [-5, -6], stockBsaPct: null, notes: '',
  };
  const exp = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
    assayType: 'DERET',
    dmsoOverride: null,
    addition: { compound_ul: 50, assayBuffer_ul: 50 },
    dmsoPlacement: 'all-buffers',
    wells: null,
    wellBufferExtra_ul: 0,
    vehicleChannel_ul: 0,
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: { ...defaultSubstrate('DERET'), enabled: false },
    fluorescein: defaultFluorescein(),
    tb: defaultTb(),
    blocks: [block],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    bufferNotes: '',
    ...over,
  });

  it('a typed well count sizes the well buffer, whatever the series covers', () => {
    const derived = computeDilutions(exp());
    expect(derived.wellsBuffered).toBeCloseTo(derived.wellsCovered, 9); // 2 rows × 200 / 50 = 8

    const typed = computeDilutions(exp({ wells: 96 }));
    expect(typed.wellsBuffered).toBe(96);
    expect(typed.wellsCovered).toBeCloseTo(8, 9); // unchanged — it still describes the series
    expect(typed.recipes.find((r) => r.id === 'well')!.required_ul).toBeCloseTo(96 * 50, 9);
  });

  it('the breakdown says what the batch is for', () => {
    const r = computeDilutions(exp({ wells: 96 }));
    const batch = r.recipes.find((x) => x.id === 'assay-buffer')!;
    const { wells_ul, compounds_ul, substrate_ul } = r.bufferUse;
    expect(wells_ul).toBeCloseTo(r.recipes.find((x) => x.id === 'well')!.base_ul, 9);
    expect(wells_ul + compounds_ul + substrate_ul).toBeLessThanOrEqual(batch.prepare_ul + 1e-9);
    expect(compounds_ul).toBeGreaterThan(0);
  });

  it('vehicle alone is more of the compounds\' own diluent, and is not a compound', () => {
    const without = computeDilutions(exp({ wells: 96 }));
    const withVehicle = computeDilutions(exp({ wells: 96, vehicleChannel_ul: 300 }));

    // it lands in the matched diluent, because it has to carry the same DMSO
    expect(withVehicle.totalDmsoBuffer_ul).toBeCloseTo(without.totalDmsoBuffer_ul + 300, 9);
    expect(withVehicle.totalNormalBuffer_ul).toBeCloseTo(without.totalNormalBuffer_ul, 9);
    expect(withVehicle.bufferUse.vehicle_ul).toBe(300);

    // and it never becomes a block at the bottom of the page
    expect(withVehicle.blocks).toHaveLength(1);
    expect(withVehicle.blocks.map((b) => b.name)).toEqual(['Nebi']);
  });

  it('with nothing to match, vehicle alone is just plain diluent', () => {
    const aqueous = { ...block, vehicle: 'aqueous' as const };
    const r = computeDilutions(exp({ wells: 96, blocks: [aqueous], vehicleChannel_ul: 300, dmsoPlacement: 'compound-only' }));
    expect(r.target).toBe(0);
    expect(r.totalNormalBuffer_ul).toBeGreaterThanOrEqual(300);
    expect(r.totalDmsoBuffer_ul).toBe(0);
  });

  it('the fluorescein grows with the vehicle channel, since it is more buffer', () => {
    const without = computeDilutions(exp({ wells: 96 }));
    const withVehicle = computeDilutions(exp({ wells: 96, vehicleChannel_ul: 3000 }));
    expect(withVehicle.fluorescein.intoBuffer!.stock_ul).toBeGreaterThan(without.fluorescein.intoBuffer!.stock_ul);
  });
});
