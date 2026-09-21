import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addRowGroup,
  clearCondition,
  enableCondition,
  migrate,
  newProject,
  PROJECT_VERSION,
  removeColumn,
  removeRowGroup,
} from '../../state/project';
import { computeGrid } from '../transfection';

describe('grid editing', () => {
  const base = newProject();

  it('adds and removes columns, keeping labels and codes in step', () => {
    const wider = addColumn(base.grid, base.dnaStocks);
    expect(wider.cols).toBe(base.grid.cols + 1);
    expect(wider.conditions[0]).toHaveLength(base.grid.cols + 1);
    expect(wider.conditions[1][wider.cols - 1].code).toBe(`B${wider.cols}`);

    const back = removeColumn(wider, base.dnaStocks, wider.cols - 1);
    expect(back.cols).toBe(base.grid.cols);
  });

  it('adds and removes row groups', () => {
    const taller = addRowGroup(base.grid, base.dnaStocks);
    expect(taller.rowGroups).toBe(base.grid.rowGroups + 1);
    expect(taller.conditions[taller.rowGroups - 1][0].code).toBe('C1');
    expect(removeRowGroup(taller, base.dnaStocks, 0).rowGroups).toBe(base.grid.rowGroups);
  });

  it('never deletes the last column or row group', () => {
    const one = removeRowGroup(removeColumn(removeColumn(removeColumn(base.grid, base.dnaStocks, 0), base.dnaStocks, 0), base.dnaStocks, 0), base.dnaStocks, 0);
    expect(removeColumn(one, base.dnaStocks, 0).cols).toBe(1);
    expect(removeRowGroup(one, base.dnaStocks, 0).rowGroups).toBe(1);
  });
});

describe('enable / clear a condition', () => {
  const base = newProject();

  it('a fresh grid has no active conditions', () => {
    expect(computeGrid(base.transfection, base.grid, base.dnaStocks).activeCount).toBe(0);
  });

  it('enable → filler-only control that counts as active; clear → hidden again', () => {
    const enabled = enableCondition(base.grid.conditions[0][0], base.dnaStocks);
    const grid = { ...base.grid, conditions: base.grid.conditions.map((r, i) => (i === 0 ? [enabled, ...r.slice(1)] : r)) };
    const res = computeGrid(base.transfection, grid, base.dnaStocks);
    expect(res.activeCount).toBe(1);
    expect(res.conditions[0].rows.at(-1)!.pct).toBe(100);

    const cleared = { ...grid, conditions: grid.conditions.map((r, i) => (i === 0 ? [clearCondition(enabled), ...r.slice(1)] : r)) };
    expect(computeGrid(base.transfection, cleared, base.dnaStocks).activeCount).toBe(0);
  });
});

describe('project migration', () => {
  it('gives a v3 project its own cell-suspension margin, unchanged from the old one', () => {
    const v3 = {
      version: 3,
      name: 'old', createdAt: '', updatedAt: '', notes: '',
      transfection: { cells_k_per_well: 30, optimemMode: 'fixed', margin: 1.4 },
      dnaStocks: [], compounds: [],
      grid: { cols: 1, rowGroups: 1, colLabels: [''], rowGroupLabels: [''], conditions: [[]] },
    };
    const m = migrate(v3) as any;
    expect(m.version).toBe(PROJECT_VERSION);
    expect(m.transfection.cellSuspensionMargin).toBe(1.4);
  });

  it('splits the old "already in the well" into plain buffer plus the substrate', () => {
    const old = {
      version: 3,
      name: 'mid-flight', createdAt: '', updatedAt: '', notes: '',
      transfection: { cells_k_per_well: 30, optimemMode: 'fixed' },
      dnaStocks: [], compounds: [],
      grid: { cols: 1, rowGroups: 1, colLabels: [''], rowGroupLabels: [''], conditions: [[]] },
      dilutions: {
        assayType: 'NanoBiT/BRET',
        dmsoOverride: null,
        addition: { compound_ul: 10, inWell_ul: 90 },
        dmsoPlacement: 'compound-only',
        blocks: [],
        bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
        substrate: { enabled: true, volumePerWell_ul: 10, wells: 96, margin: 1.2, reference: 'as-prepared', basis: 'prepared', components: [], notes: '' },
        bufferNotes: '',
      },
    };
    const m = migrate(old) as any;
    // 90 µl in the well was 80 µl of buffer plus the substrate's own 10 µl
    expect(m.dilutions.addition).toEqual({ compound_ul: 10, assayBuffer_ul: 80 });
    expect(m.dilutions.substrate.basis).toBeUndefined();
    expect(m.dilutions.substrate.reference).toBe('after-compounds');
  });

  it('turns an old in-well factor into the addition it stood for', () => {
    const old = {
      version: 3,
      name: 'mid-flight', createdAt: '', updatedAt: '', notes: '',
      transfection: { cells_k_per_well: 30, optimemMode: 'fixed' },
      dnaStocks: [], compounds: [],
      grid: { cols: 1, rowGroups: 1, colLabels: [''], rowGroupLabels: [''], conditions: [[]] },
      dilutions: {
        assayType: 'NanoBiT/BRET',
        dmsoOverride: null,
        inWellFactor: 2,
        blocks: [{ id: 'b', name: 'Iso', volForWells_ul: 200, dilutionFactor: 2, stockConc_uM: 10000, vehicle: 'aqueous', margin: 1, excludeFromVehicleMatch: false, logM: [-5], notes: '' }],
        bsa: { enabled: true, targetPct: 0.02, stockPct: 5, basis: 'in-well' },
        bufferNotes: '',
      },
    };
    const m = migrate(old) as any;
    // 2× used to mean equal volumes: 10 µl of compound into 10 µl of buffer.
    expect(m.dilutions.addition).toEqual({ compound_ul: 10, assayBuffer_ul: 10 });
    expect(m.dilutions.inWellFactor).toBeUndefined();
    // an 'in-well' BSA basis meant the buffer was premixed that much stronger
    expect(m.dilutions.bsa.targetPct).toBeCloseTo(0.04, 12);
    expect(m.dilutions.bsa.placement).toBe('compound-only');
    expect(m.dilutions.bsa.basis).toBeUndefined();
    expect(m.dilutions.blocks[0].dilutionFactorOverride).toBeNull();
  });

  it('gives a v2 project an empty dilutions section', () => {
    const v2 = {
      version: 2,
      name: 'old', createdAt: '', updatedAt: '', notes: '',
      transfection: { cells_k_per_well: 30, optimemMode: 'fixed' },
      dnaStocks: [], compounds: [],
      grid: { cols: 1, rowGroups: 1, colLabels: [''], rowGroupLabels: [''], conditions: [[]] },
    };
    const m = migrate(v2);
    expect(m.version).toBe(PROJECT_VERSION);
    expect(m.dilutions.assayType).toBe('NanoBiT/BRET');
    expect(m.dilutions.addition.compound_ul).toBeGreaterThan(0);
    expect(m.dilutions.addition.assayBuffer_ul).toBeGreaterThanOrEqual(0);
    expect(m.dilutions.dmsoPlacement).toBe('compound-only');
    expect(m.dilutions.blocks.length).toBeGreaterThan(0);
  });

  it('converts v1 cells/well from millions to thousands and fills every field added since', () => {
    const v1 = {
      version: 1,
      name: 'old',
      createdAt: '', updatedAt: '', notes: '',
      transfection: { cells_M_per_well: 0.03, wellsPerCondition: 12 },
      dnaStocks: [{ id: 'a', name: 'pcDNA', stockConc_ng_per_ul: 1000, isFiller: true }],
      grid: { cols: 1, rowGroups: 1, colLabels: [''], rowGroupLabels: [''], conditions: [[]] },
    };
    // A v1 file is carried through every later step in one go, not just the next one.
    const m = migrate(v1) as any;
    expect(m.version).toBe(PROJECT_VERSION);
    expect(m.transfection.cells_k_per_well).toBe(30);
    expect(m.transfection.cells_M_per_well).toBeUndefined();
    expect(m.dnaStocks[0].plasmidId).toBe('');
    expect(m.compounds).toEqual([]);
    expect(m.dilutions.blocks[0].logM.every((v: number | null) => v === null)).toBe(true);
  });
});
