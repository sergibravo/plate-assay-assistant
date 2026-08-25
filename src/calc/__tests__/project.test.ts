import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addRowGroup,
  clearCondition,
  enableCondition,
  migrate,
  newProject,
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
  it('converts v1 cells/well from millions to thousands and fills new fields', () => {
    const v1 = {
      version: 1,
      name: 'old',
      createdAt: '', updatedAt: '', notes: '',
      transfection: { cells_M_per_well: 0.03, wellsPerCondition: 12 },
      dnaStocks: [{ id: 'a', name: 'pcDNA', stockConc_ng_per_ul: 1000, isFiller: true }],
      grid: { cols: 1, rowGroups: 1, colLabels: [''], rowGroupLabels: [''], conditions: [[]] },
    };
    const m = migrate(v1) as any;
    expect(m.version).toBe(2);
    expect(m.transfection.cells_k_per_well).toBe(30);
    expect(m.transfection.cells_M_per_well).toBeUndefined();
    expect(m.dnaStocks[0].plasmidId).toBe('');
    expect(m.compounds).toEqual([]);
  });
});
