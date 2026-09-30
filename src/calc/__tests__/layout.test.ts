import { describe, expect, it } from 'vitest';
import {
  addTreatment,
  emptyLayout,
  isEdgeWell,
  removeTreatment,
  replicateGroups,
  reshapeLayout,
  resolveWells,
  summarise,
  toLongTable,
  transfectionPaints,
  treatmentPaints,
  wellsPerTreatment,
  type PlateLayout,
} from '../layout';
import { defaultFluorescein, defaultTb } from '../deret';
import { defaultSubstrate } from '../substrate';
import { computeDilutions, type DilutionExperiment } from '../dilutions';
import { newProject } from '../../state/project';

const exp = (over: Partial<DilutionExperiment> = {}): DilutionExperiment => ({
  assayType: 'NanoBiT/BRET',
  dmsoOverride: null,
  addition: { compound_ul: 10, assayBuffer_ul: 80 },
  dmsoPlacement: 'compound-only',
  wells: null,
  wellBufferExtra_ul: 0,
  bufferChannels: [{ id: 'v', name: 'Vehicle alone', volume_ul: 300, extraVolume_ul: 0, vehicle: 'DMSO', colour: '#667085' }],
  premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
  substrate: { ...defaultSubstrate('NanoBiT/BRET'), enabled: false },
  fluorescein: { ...defaultFluorescein(), enabled: false },
  tb: { ...defaultTb(), enabled: false },
  blocks: [{
    id: 'b', name: 'AngII', colour: '#2563eb', volForWells_ul: 200, dilutionFactorOverride: null,
    stockConc_uM: 10000, vehicle: 'aqueous', extraVolume_ul: 0, excludeFromVehicleMatch: false,
    logM: [-5, -6, -7, null], stockBsaPct: null, notes: '',
  }],
  bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
  bufferNotes: '',
  ...over,
});

function painted(): PlateLayout {
  const l = emptyLayout('96-well');
  l.rowTransfection[0] = 'condA';
  l.rowTransfection[1] = 'condB';
  l.rowTime[0] = '0 min';
  // duplicates side by side, one dose per column pair
  l.wells.A1 = { treatments: ['cmp:b:0'] };
  l.wells.A2 = { treatments: ['cmp:b:0'] };
  l.wells.A3 = { treatments: ['cmp:b:1'] };
  l.wells.A4 = { treatments: ['cmp:b:1'] };
  l.wells.B1 = { treatments: ['cmp:b:0'] };
  l.wells.B2 = { treatments: ['cmp:b:0'] };
  return l;
}

describe('a well holds what is in it', () => {
  it('takes its cells from the row unless the well says otherwise', () => {
    const l = painted();
    l.wells.A5 = { transfectionId: 'condC', treatments: ['buf:v'] };
    const wells = resolveWells(l);
    expect(wells.find((w) => w.id === 'A1')).toMatchObject({ transfectionId: 'condA', timePoint: '0 min' });
    expect(wells.find((w) => w.id === 'A5')!.transfectionId).toBe('condC');
    expect(wells.find((w) => w.id === 'C1')!.transfectionId).toBeNull();
  });

  it('can be emptied of cells on its own', () => {
    const l = painted();
    l.wells.A1 = { ...l.wells.A1, transfectionId: null };
    expect(resolveWells(l).find((w) => w.id === 'A1')!.transfectionId).toBeNull();
  });

  it('holds an inhibitor and a ligand at once', () => {
    const paints = treatmentPaints(exp());
    const angII = paints.find((p) => p.id === 'cmp:b:0')!;
    const vehicle = paints.find((p) => p.id === 'buf:v')!;
    let treatments = addTreatment([], vehicle);
    treatments = addTreatment(treatments, angII);
    expect(treatments).toEqual(['buf:v', 'cmp:b:0']);
  });

  it('a second dose of the same compound replaces the first, not joins it', () => {
    const paints = treatmentPaints(exp());
    const low = paints.find((p) => p.id === 'cmp:b:2')!;
    const high = paints.find((p) => p.id === 'cmp:b:0')!;
    const treatments = addTreatment(addTreatment([], low), high);
    expect(treatments).toEqual(['cmp:b:0']);
  });

  it('a treatment can be lifted off again', () => {
    expect(removeTreatment(['buf:v', 'cmp:b:0'], 'buf:v')).toEqual(['cmp:b:0']);
  });
});

describe('paints come from the other modules', () => {
  it('a dilution series shades from the compound colour, palest at the lowest dose', () => {
    const paints = treatmentPaints(exp());
    const steps = paints.filter((p) => p.kind === 'compound');
    expect(steps.map((p) => p.id)).toEqual(['cmp:b:0', 'cmp:b:1', 'cmp:b:2']);
    expect(steps[0].label).toBe('AngII 10 µM');
    expect(steps[2].label).toBe('AngII 100 nM'); // sub-µM reads in nM, as it is spoken
    // the top dose keeps the block's own colour; the lowest is paler
    expect(steps[0].colour.toLowerCase()).toBe('#2563eb');
    expect(steps[2].colour).not.toBe(steps[0].colour);
  });

  it('empty rows of a series are not paints', () => {
    expect(treatmentPaints(exp()).filter((p) => p.kind === 'compound')).toHaveLength(3);
  });

  it('buffer channels are paints too, in their own colour', () => {
    const channel = treatmentPaints(exp()).find((p) => p.kind === 'channel')!;
    expect(channel).toMatchObject({ id: 'buf:v', label: 'Vehicle alone', colour: '#667085' });
  });

  it('only conditions in use can be painted', () => {
    const p = newProject();
    const [stock] = p.dnaStocks;
    const grid = {
      ...p.grid,
      conditions: p.grid.conditions.map((row, r) =>
        row.map((c, col) =>
          r === 0 && col === 0
            ? { ...c, label: 'low hibit', entries: c.entries.map((e) => (e.dnaStockId === stock.id ? { ...e, pct: 0.5 } : e)) }
            : c,
        ),
      ),
    };
    expect(transfectionPaints(grid).map((o) => o.label)).toEqual(['A1 — low hibit']);
  });
});

describe('what the plate tells module 3', () => {
  it('counts the wells painted with each step', () => {
    expect(wellsPerTreatment(painted())).toEqual({ 'cmp:b:0': 4, 'cmp:b:1': 2 });
  });

  it('counts a well once per treatment it holds', () => {
    const l = painted();
    l.wells.A1 = { treatments: ['cmp:b:0', 'buf:v'] };
    const counts = wellsPerTreatment(l);
    expect(counts['cmp:b:0']).toBe(4);
    expect(counts['buf:v']).toBe(1);
  });
});

describe('what the plate says back', () => {
  it('groups replicates by cells, treatments and time together', () => {
    const groups = replicateGroups(painted());
    const topDoseA = groups.find((g) => g.transfectionId === 'condA' && g.treatments.includes('cmp:b:0'))!;
    expect(topDoseA.wells).toEqual(['A1', 'A2']);
    expect(topDoseA.timePoint).toBe('0 min');
  });

  it('summarises the plate, including what has cells but nothing on them', () => {
    const s = summarise(painted());
    expect(s.total).toBe(96);
    // 2 seeded rows of 12, of which 6 are painted; nothing is treated without cells
    expect(s.used).toBe(24);
    expect(s.untreated).toBe(18);
    expect(s.unseeded).toBe(0);
    expect(s.wellsPerTreatment).toEqual({ 'cmp:b:0': 4, 'cmp:b:1': 2 });
  });

  it('flags treatment with no cells under it', () => {
    const l = emptyLayout('96-well');
    l.wells.D6 = { treatments: ['cmp:b:0'] };
    expect(summarise(l).unseeded).toBe(1);
  });

  it('knows its edges', () => {
    const wells = resolveWells(emptyLayout('96-well'));
    expect(isEdgeWell(wells.find((w) => w.id === 'A1')!, '96-well')).toBe(true);
    expect(isEdgeWell(wells.find((w) => w.id === 'D6')!, '96-well')).toBe(false);
  });

  it('reshapes to 384 and back, keeping what fits', () => {
    const big = reshapeLayout(emptyLayout('384-well'), '384-well');
    big.wells.P24 = { treatments: ['cmp:b:0'] };
    big.wells.A1 = { treatments: ['cmp:b:0'] };
    const small = reshapeLayout(big, '96-well');
    expect(small.wells.P24).toBeUndefined();
    expect(small.wells.A1).toBeDefined();
    expect(small.rowTransfection).toHaveLength(8);
  });
});

describe('the tidy table', () => {
  const transfections = [
    { id: 'condA', label: 'A1 — pcDNA', short: 'A1', colour: '#2563eb', kind: 'transfection' as const },
    { id: 'condB', label: 'A2 — hibit', short: 'A2', colour: '#047857', kind: 'transfection' as const },
  ];

  it('gives one row per used well, numbering replicates within a group', () => {
    const table = toLongTable(painted(), transfections, treatmentPaints(exp()));
    const a1 = table.find((r) => r.well === 'A1')!;
    expect(a1).toMatchObject({ row: 'A', col: 1, transfection: 'A1 — pcDNA', treatments: 'AngII 10 µM', replicate: 1, time: '0 min' });
    expect(table.find((r) => r.well === 'A2')!.replicate).toBe(2);
    expect(table.find((r) => r.well === 'B1')!.replicate).toBe(1); // different cells, own group
  });

  it('joins several treatments in one cell', () => {
    const l = painted();
    l.wells.A1 = { treatments: ['buf:v', 'cmp:b:0'] };
    const row = toLongTable(l, transfections, treatmentPaints(exp())).find((r) => r.well === 'A1')!;
    expect(row.treatments).toBe('Vehicle alone + AngII 10 µM');
  });

  it('says so when what a well pointed at is gone', () => {
    const row = toLongTable(painted(), [], []).find((r) => r.well === 'A1')!;
    expect(row.transfection).toBe('(deleted condition)');
    expect(row.treatments).toBe('(deleted treatment)');
  });
});

describe('the plate sizes the dilution steps', () => {
  const blockOf = (over = {}) => ({
    id: 'b', name: 'AngII', colour: '#2563eb', volForWells_ul: 200, dilutionFactorOverride: null,
    stockConc_uM: 10000, vehicle: 'aqueous' as const, extraVolume_ul: 0, excludeFromVehicleMatch: false,
    logM: [-5, -6, -7, null], stockBsaPct: null, notes: '', ...over,
  });

  it('a step covered by the plate is prepared for those wells, not the typed figure', () => {
    const counts = wellsPerTreatment(painted()); // 4 wells at step 0, 2 at step 1
    const r = computeDilutions(exp({ blocks: [blockOf()], wellsPerTreatment: counts }));
    const rows = r.blocks[0].rows;
    // 10 µl per well: step 0 needs 40 µl for its wells, step 1 needs 20 µl
    expect(rows[1].leftForWells_ul).toBeGreaterThanOrEqual(20);
    expect(rows[1].volToPrepare_ul).toBeLessThan(200); // nothing like the typed 200 µl
    // the top tube still carries what the tube below draws from it
    expect(rows[0].leftForWells_ul).toBeGreaterThanOrEqual(40);
  });

  it('a step the plate says nothing about keeps the typed figure', () => {
    const r = computeDilutions(exp({ blocks: [blockOf()], wellsPerTreatment: { 'cmp:b:0': 4 } }));
    // step 2 is unpainted, so it falls back to 200 µl
    expect(r.blocks[0].rows[2].leftForWells_ul).toBeGreaterThanOrEqual(200);
  });

  it('with no plate at all, nothing changes', () => {
    const typed = computeDilutions(exp({ blocks: [blockOf()] }));
    const withNull = computeDilutions(exp({ blocks: [blockOf()], wellsPerTreatment: null }));
    expect(withNull.blocks[0].rows).toEqual(typed.blocks[0].rows);
  });

  it('the extra per tube is still added on top of what the plate asks for', () => {
    const counts = { 'cmp:b:0': 4, 'cmp:b:1': 4, 'cmp:b:2': 4 };
    const plain = computeDilutions(exp({ blocks: [blockOf()], wellsPerTreatment: counts }));
    const withExtra = computeDilutions(exp({ blocks: [blockOf({ extraVolume_ul: 50 })], wellsPerTreatment: counts }));
    expect(withExtra.blocks[0].rows[2].volToPrepare_ul).toBe(plain.blocks[0].rows[2].volToPrepare_ul + 50);
  });

  it('the wells the series covers now come from the plate', () => {
    const r = computeDilutions(exp({ blocks: [blockOf()], wellsPerTreatment: wellsPerTreatment(painted()) }));
    // 4 wells at the top dose + 2 at the next + 200 µl worth of the unpainted third
    expect(r.wellsCovered).toBeCloseTo(4 + 2 + 20, 9);
  });
});
