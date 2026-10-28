import { describe, expect, it } from 'vitest';
import { defaultFluorescein, defaultTb } from '../deret';
import {
  computeDilutions,
  DMR_ADDITION,
  INHIBITOR_VEHICLE_PAINT,
  type CompoundBlock,
  type DilutionExperiment,
  type Inhibitor,
} from '../dilutions';
import { addTreatment, treatmentPaints } from '../layout';
import { defaultSubstrate } from '../substrate';
import { defaultInhibitorStep, migrate, newProject, PROJECT_VERSION } from '../../state/project';
import { dilutionBenchSheetRows } from '../../export/dilutionsheet';

const block = (over: Partial<CompoundBlock> = {}): CompoundBlock => ({
  id: 'b', name: 'agonist', colour: '#2563eb', volForWells_ul: 200, dilutionFactorOverride: null,
  stockConc_uM: 10000, vehicle: 'aqueous', extraVolume_ul: 0, excludeFromVehicleMatch: false,
  logM: [-5, -6], stockBsaPct: null, notes: '',
  ...over,
});

const inhibitor = (over: Partial<Inhibitor> = {}): Inhibitor => ({
  id: 'i1', name: 'YM-254890', colour: '#9f1239', conc_uM: 10, foldOverride: null,
  stockConc_uM: 10000, vehicle: 'DMSO', stockBsaPct: null, wells: 0, extraVolume_ul: 0, notes: '',
  ...over,
});

const NO_BSA = { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' as const };

const dmr = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
  assayType: 'DMR',
  dmsoOverride: null,
  addition: { ...DMR_ADDITION },
  dmsoPlacement: 'compound-only',
  wells: null,
  wellBufferExtra_ul: 0,
  bufferChannels: [],
  premixOverrides: {},
  compoundPlate_ul: 25,
  inhibitors: defaultInhibitorStep(),
  // Left switched on from a BRET run: DMR must ignore it.
  substrate: defaultSubstrate('NanoBiT/BRET'),
  fluorescein: defaultFluorescein(),
  tb: defaultTb(),
  blocks: [block()],
  bsa: NO_BSA,
  bufferNotes: '',
  ...over,
});

/** 20 µl buffer + 10 µl inhibitor + 10 µl compound. */
const withInhibitors = (items: Inhibitor[], over: Partial<DilutionExperiment> = {}) =>
  dmr({
    addition: { assayBuffer_ul: 20, compound_ul: 10 },
    inhibitors: { ...defaultInhibitorStep(), enabled: true, vehicleExtra_ul: 0, items },
    ...over,
  });

describe('DMR', () => {
  it('is label-free: compounds in HBSS/HEPES, 10 µl into 30 µl is ×4, no substrate', () => {
    const r = computeDilutions(dmr());
    expect(r.assay.diluent).toBe('HBSS/HEPES');
    expect(r.additionFactor).toBeCloseTo(4, 12);
    expect(r.substrate.enabled).toBe(false);
    expect(r.recipes.some((x) => x.id === 'substrate')).toBe(false);
    expect(r.blocks[0].rows[0].tubeConc_uM).toBeCloseTo(40, 9); // 10 µM in the well
  });

  it('sizes a painted step by what a compound-plate well holds, not by the 10 µl the cells get', () => {
    const exp = dmr({ wellsPerTreatment: { 'cmp:b:0': 4, 'cmp:b:1': 4 } });
    const r = computeDilutions(exp);
    // Bottom tube: 4 wells × 25 µl. Top tube carries its own 100 µl + the 10 µl the next draws.
    expect(r.blocks[0].rows[1].volToPrepare_ul).toBe(100);
    expect(r.blocks[0].rows[0].volToPrepare_ul).toBe(110);
    expect(r.wellsCovered).toBeCloseTo(8, 12);
    // …and the cells under those 8 wells get 30 µl of buffer each.
    expect(r.recipes.find((x) => x.id === 'well')!.required_ul).toBeCloseTo(8 * 30, 9);
  });

  it('without a compound plate, a painted well takes the addition, as before', () => {
    const r = computeDilutions(dmr({ compoundPlate_ul: null, wellsPerTreatment: { 'cmp:b:1': 4 } }));
    expect(r.blocks[0].rows[1].volToPrepare_ul).toBe(40);
  });

  it('keeps BSA selectable, and DMSO the same in every liquid — the wash buffer included', () => {
    const r = computeDilutions(
      dmr({
        // Asking for DMSO only in the compound changes nothing: DMR has one level everywhere.
        dmsoPlacement: 'compound-only',
        blocks: [block({ vehicle: 'DMSO' })],
        bsa: { enabled: true, targetPct: 0.1, stockPct: 10, placement: 'all-buffers' },
      }),
    );
    expect(r.target).toBeCloseTo(0.004, 12); // 40 µM out of 10 mM
    expect(r.inWellDmso).toBeCloseTo(0.004, 12); // the cells never see it change
    expect(r.bsaInWell).toBeCloseTo(0.001, 12);
    expect(r.recipes.find((x) => x.id === 'dmso')!.name).toBe('For the compounds — HBSS/HEPES + 0.1 % BSA + 0.4 % DMSO');
    const wash = r.recipes.find((x) => x.id === 'well')!;
    expect(wash.name).toBe('Wash buffer — what stays on the cells');
    expect(wash.achievedDmso).toBeCloseTo(0.004, 6);
  });

  it('with no DMSO stock at all, nothing carries DMSO', () => {
    const r = computeDilutions(dmr());
    expect(r.target).toBe(0);
    expect(r.recipes.find((x) => x.id === 'well')!.dmso_ul).toBe(0);
  });
});

describe('inhibitor step', () => {
  it('prepares inhibitors at ×3 (10 µl into 20 µl) and compounds still at ×4', () => {
    const r = computeDilutions(withInhibitors([inhibitor()]));
    expect(r.additionFactor).toBeCloseTo(4, 12);
    expect(r.inhibitors!.defaultFold).toBeCloseTo(3, 12);
    expect(r.inhibitors!.items[0].tubeConc_uM).toBeCloseTo(30, 12);
  });

  it('lets each inhibitor choose its own fold', () => {
    const r = computeDilutions(withInhibitors([inhibitor({ foldOverride: 4 })]));
    expect(r.inhibitors!.items[0].fold).toBe(4);
    expect(r.inhibitors!.items[0].tubeConc_uM).toBeCloseTo(40, 12);
  });

  it('sizes each inhibitor and its vehicle by hand: wells painted × 10 µl, not a compound-plate well', () => {
    const exp = withInhibitors([inhibitor()], {
      wellsPerTreatment: { 'inh:i1': 8, [INHIBITOR_VEHICLE_PAINT]: 4 },
    });
    const r = computeDilutions(exp);
    const item = r.inhibitors!.items[0];
    expect(item.painted).toBe(true);
    expect(r.inhibitors!.perWell_ul).toBe(10);
    expect(item.tube!.volToPrepare_ul).toBe(80); // 8 × 10
    expect(item.tube!.aliquotIn_ul).toBeCloseTo(0.24, 12); // 80 µl at 30 µM from 10 mM
    expect(r.inhibitors!.vehicle.required_ul).toBe(40); // 4 × 10
  });

  it('lets the µl prepared per inhibitor well be raised, to keep some in hand', () => {
    const base = withInhibitors([inhibitor()], { wellsPerTreatment: { 'inh:i1': 8, [INHIBITOR_VEHICLE_PAINT]: 4 } });
    const r = computeDilutions({ ...base, inhibitors: { ...base.inhibitors!, preparedPerWell_ul: 15 } });
    expect(r.inhibitors!.items[0].tube!.volToPrepare_ul).toBe(120);
    expect(r.inhibitors!.vehicle.required_ul).toBe(60);
  });

  it('in DMR, brings inhibitors, vehicle, compounds and wash buffer to the highest DMSO', () => {
    const r = computeDilutions(
      withInhibitors([inhibitor()], { blocks: [block({ vehicle: 'DMSO' })], wellsPerTreatment: { 'inh:i1': 8 } }),
    );
    // Compounds need 0.4 % (×4), the inhibitor 0.3 % (×3): everything goes to 0.4 %.
    expect(r.target).toBeCloseTo(0.004, 12);
    expect(r.inhibitors!.target).toBeCloseTo(0.004, 12);
    expect(r.inhibitors!.items[0].tube!.dmsoFraction).toBeCloseTo(0.004, 9);
    expect(r.inhibitors!.sharesCompoundDiluent).toBe(true);
    expect(r.recipes.some((x) => x.id === 'inhibitor-dmso')).toBe(false);
    expect(r.inWellDmso).toBeCloseTo(0.004, 12);
    expect(r.inhibitors!.inWellDmsoBeforeCompounds).toBeCloseTo(0.004, 12);
  });

  it('in DMR, an inhibitor needing more DMSO than the compounds sets the level for all', () => {
    const r = computeDilutions(
      withInhibitors([inhibitor()], { wellsPerTreatment: { 'inh:i1': 8 } }), // aqueous compounds
    );
    expect(r.target).toBeCloseTo(0.003, 12);
    // The aqueous compound's top tube is topped up with DMSO diluent to match.
    expect(r.blocks[0].rows[0].dmsoFraction).toBeCloseTo(0.003, 4); // a hair under: the aqueous stock aliquot carries none
  });

  it('elsewhere, with DMSO only in the additions, matches the inhibitors among themselves', () => {
    const exp = withInhibitors(
      [inhibitor(), inhibitor({ id: 'i2', name: 'weaker', conc_uM: 1 })],
      {
        assayType: 'NanoBiT/BRET',
        substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false },
        wellsPerTreatment: { 'inh:i1': 8, 'inh:i2': 8, [INHIBITOR_VEHICLE_PAINT]: 4 },
      },
    );
    const r = computeDilutions(exp);
    expect(r.inhibitors!.target).toBeCloseTo(0.003, 12); // 30 µM out of 10 mM
    // The weaker inhibitor is topped up to the same DMSO, so its wells match.
    expect(r.inhibitors!.items[1].tube!.dmsoFraction).toBeCloseTo(0.003, 9);
    expect(r.inhibitors!.vehicle.matched).toBe(true);
    // Aqueous compounds have nothing to match, so the inhibitors need their own DMSO diluent.
    expect(r.target).toBe(0);
    expect(r.inhibitors!.sharesCompoundDiluent).toBe(false);
    const own = r.recipes.find((x) => x.id === 'inhibitor-dmso')!;
    expect(own.required_ul).toBeCloseTo(r.inhibitors!.items[1].tube!.dmsoBuffer_ul + 40, 9);
    expect(own.dmso_ul / own.prepare_ul).toBeCloseTo(0.003, 9);
  });

  it('elsewhere, with DMSO only in the additions, adds the inhibitor’s DMSO to the compound’s', () => {
    const r = computeDilutions(
      withInhibitors([inhibitor()], {
        assayType: 'NanoBiT/BRET',
        substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false },
        blocks: [block({ vehicle: 'DMSO' })],
        wellsPerTreatment: { 'inh:i1': 8 },
      }),
    );
    // Compound diluent at 0.4 % (×4), inhibitors at 0.3 % (×3), 10 µl of each in 40 µl.
    expect(r.target).toBeCloseTo(0.004, 12);
    expect(r.inWellDmso).toBeCloseTo((0.004 * 10 + 0.003 * 10) / 40, 12);
    expect(r.inhibitors!.inWellDmsoBeforeCompounds).toBeCloseTo((0.003 * 10) / 30, 12);
  });

  it('shares one DMSO level when every buffer carries DMSO', () => {
    const r = computeDilutions(
      withInhibitors([inhibitor()], {
        dmsoPlacement: 'all-buffers',
        blocks: [block({ vehicle: 'DMSO', logM: [-7] })], // 0.4 µM → 0.004 % from the compound
        wellsPerTreatment: { 'inh:i1': 8 },
      }),
    );
    // The inhibitor needs more (0.3 %), so the whole well sits there.
    expect(r.target).toBeCloseTo(0.003, 12);
    expect(r.inhibitors!.target).toBeCloseTo(0.003, 12);
    expect(r.inhibitors!.sharesCompoundDiluent).toBe(true);
    expect(r.recipes.some((x) => x.id === 'inhibitor-dmso')).toBe(false);
    expect(r.inWellDmso).toBeCloseTo(0.003, 12);
  });

  it('switched off, changes nothing', () => {
    const items = [inhibitor()];
    const off = computeDilutions(
      dmr({ inhibitors: { ...defaultInhibitorStep(), enabled: false, items } }),
    );
    const absent = computeDilutions(dmr({ inhibitors: undefined }));
    expect(off.inhibitors).toBeNull();
    expect(off.recipes).toEqual(absent.recipes);
    expect(off.blocks).toEqual(absent.blocks);
  });

  it('flags an inhibitor with no wells', () => {
    const r = computeDilutions(withInhibitors([inhibitor()]));
    expect(r.warnings.some((w) => w.code === 'inhibitor-no-wells')).toBe(true);
  });
});

describe('inhibitors on the plate', () => {
  const exp = withInhibitors([inhibitor(), inhibitor({ id: 'i2', name: 'other' })]);
  const paints = treatmentPaints(exp);

  it('are offered as paints only while the step is on, with their vehicle', () => {
    expect(paints.filter((p) => p.kind === 'inhibitor').map((p) => p.id)).toEqual(['inh:i1', 'inh:i2', INHIBITOR_VEHICLE_PAINT]);
    const off = treatmentPaints({ ...exp, inhibitors: { ...exp.inhibitors!, enabled: false } });
    expect(off.some((p) => p.kind === 'inhibitor')).toBe(false);
  });

  it('a well takes one inhibitor (or the vehicle), alongside its compound', () => {
    const i1 = paints.find((p) => p.id === 'inh:i1')!;
    const vehicle = paints.find((p) => p.id === INHIBITOR_VEHICLE_PAINT)!;
    const withCompound = addTreatment(['cmp:b:0'], i1);
    expect(withCompound).toEqual(['cmp:b:0', 'inh:i1']);
    expect(addTreatment(withCompound, vehicle)).toEqual(['cmp:b:0', INHIBITOR_VEHICLE_PAINT]);
  });
});

describe('the bench sheet', () => {
  it('lists the compound plate, the inhibitors and their vehicle', () => {
    const exp = withInhibitors([inhibitor()], { wellsPerTreatment: { 'inh:i1': 8, [INHIBITOR_VEHICLE_PAINT]: 4 } });
    const project = { ...newProject('DMR run'), dilutions: exp };
    const text = dilutionBenchSheetRows(project, computeDilutions(exp))
      .flat()
      .map((c) => (c !== null && typeof c === 'object' ? c.v : c))
      .join(' | ');
    expect(text).toContain('20 µl buffer + 10 µl inhibitor + 10 µl compound');
    expect(text).toContain('Compound plate');
    expect(text).toContain('INHIBITORS — BEFORE THE COMPOUNDS');
    expect(text).toContain('YM-254890');
    expect(text).toContain('Matched vehicle');
  });
});

describe('older files', () => {
  it('open with no compound plate and the inhibitor step off', () => {
    const m = migrate({
      version: 5, name: 'x', createdAt: '', updatedAt: '', notes: '',
      dilutions: { assayType: 'HiBiT', addition: { compound_ul: 10, assayBuffer_ul: 80 } },
    });
    expect(m.version).toBe(PROJECT_VERSION);
    expect(PROJECT_VERSION).toBe(6);
    expect(m.dilutions.compoundPlate_ul).toBeNull();
    expect(m.dilutions.inhibitors!.enabled).toBe(false);
  });
});

describe('DMSO labels', () => {
  it('name a premix at two decimals, whatever the exact % behind it', () => {
    // A 10.26 mM stock puts the top tube's load at 0.3898…%, not a round 0.4 %.
    const exp = dmr({ blocks: [block({ vehicle: 'DMSO', stockConc_uM: 10260 })] });
    const r = computeDilutions(exp);
    expect(r.target * 100).toBeCloseTo(0.389864, 6);
    expect(r.recipes.find((x) => x.id === 'dmso')!.name).toBe('For the compounds — HBSS/HEPES + 0.39 % DMSO');
  });
});
