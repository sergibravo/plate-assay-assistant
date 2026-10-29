import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { computeGrid, masterMix, perCondition } from '../transfection';
import { roundUl } from '../units';
import { transfectionBenchSheetRows } from '../../export/benchsheet';
import { enableCondition, newProject } from '../../state/project';

/** A project with one real condition and one filler-only control. */
function demoProject() {
  const p = newProject('Demo run');
  const [hibit] = p.dnaStocks;
  const conditions = p.grid.conditions.map((row, rg) =>
    row.map((c, col) => {
      if (rg === 0 && col === 0) {
        return { ...c, label: 'low hibit', entries: c.entries.map((e) => (e.dnaStockId === hibit.id ? { ...e, pct: 0.5 } : e)) };
      }
      if (rg === 0 && col === 1) return enableCondition({ ...c, label: 'no receptor' }, p.dnaStocks);
      return c;
    }),
  );
  return { ...p, grid: { ...p.grid, conditions } };
}

describe('bench sheet export', () => {
  const project = demoProject();
  const per = perCondition(project.transfection);
  const grid = computeGrid(project.transfection, project.grid, project.dnaStocks);
  const mix = masterMix(project.transfection, grid.activeCount);
  const { setup, dnaMixes } = transfectionBenchSheetRows(project, per, mix, grid.conditions);

  const flat = (rows: unknown[][]) =>
    rows.flat().map((c) => (c && typeof c === 'object' ? (c as { v: unknown }).v : c));

  it('carries the numbers a scientist pipettes', () => {
    const cells = flat(setup);
    expect(cells).toContain('Total PEI');
    // shown to what a pipette can deliver, not to every digit
    expect(cells).toContain(roundUl(mix.totalPei_ul));
    expect(cells).toContain(roundUl(mix.totalOptimemForPei_ul));
    expect(cells).toContain('k cells');
  });

  it('includes only the conditions in use, with plasmid IDs and tube totals', () => {
    const cells = flat(dnaMixes).filter((c) => typeof c === 'string');
    expect(cells.some((c) => String(c).startsWith('A1 — low hibit'))).toBe(true);
    expect(cells.some((c) => String(c).startsWith('A2 — no receptor'))).toBe(true);
    expect(cells.some((c) => String(c).startsWith('B1'))).toBe(false); // untouched blocks stay out
    expect(cells).toContain('+ OptiMEM');
    expect(cells).toContain('= tube total');
  });

  it('sets every cell one point above the 11 pt default', () => {
    const sizes = [...setup, ...dnaMixes]
      .flat()
      .filter((c) => c && typeof c === 'object')
      .map((c) => ((c as { s?: any }).s?.font?.sz as number | undefined));
    expect(sizes.length).toBeGreaterThan(30);
    // Every cell carries an explicit size — nothing falls back to Excel's 11 pt default.
    expect(sizes.every((sz) => typeof sz === 'number')).toBe(true);
    // Body text 11 → 12, the 12 pt block headings → 13, the 15 pt title → 16,
    // and the small muted captions 10 → 11.
    expect(new Set(sizes as number[])).toEqual(new Set([11, 12, 13, 16]));
  });

  it('styles every condition table with its own colour and writes a valid workbook', () => {
    const styled = dnaMixes
      .flat()
      .map((c) => (c && typeof c === 'object' ? (c.s as any) : undefined))
      .filter((s) => s?.fill?.fgColor?.rgb);
    const fills = new Set(styled.map((s) => s.fill.fgColor.rgb as string));
    expect(fills.size).toBeGreaterThan(1);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dnaMixes.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)))), 'DNA Mixes');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    expect(out.byteLength).toBeGreaterThan(0);
  });
});

describe('bench sheet in dish mode, with an own count', () => {
  const base = demoProject();
  const project = {
    ...base,
    transfection: { ...base.transfection, mode: 'dish' as const },
    // A1 on two 6 cm dishes, A2 at the default one.
    grid: { ...base.grid, conditions: base.grid.conditions.map((row) => row.map((c) => (c.code === 'A1' ? { ...c, dishes: 2 } : c))) },
  };
  const per = perCondition(project.transfection);
  const grid = computeGrid(project.transfection, project.grid, project.dnaStocks);
  const mix = masterMix(project.transfection, grid.activeUnits);
  const { setup, dnaMixes } = transfectionBenchSheetRows(project, per, mix, grid.conditions);
  const flat = (rows: unknown[][]) => rows.flat().map((c) => (c && typeof c === 'object' ? (c as { v: unknown }).v : c));

  it('says it is a 6 cm dish transfection, of which cells', () => {
    const cells = flat(setup);
    expect(cells).toContain('DISH TRANSFECTION BENCH SHEET — 6 cm');
    expect(cells).toContain('HEK293 parental');
    expect(cells).toContain('DNA per dish');
    expect(cells).not.toContain('DNA per well');
  });

  it('sizes the master mix from 3 dishes: 27 µl PEI + 450 µl OptiMEM', () => {
    expect(mix.totalUnits).toBe(3);
    const cells = flat(setup);
    expect(cells).toContain(roundUl(27));
    expect(cells).toContain(450);
  });

  it('gives each condition its count and its own PEI mix volume', () => {
    const cells = flat(dnaMixes);
    expect(cells.some((v) => typeof v === 'string' && v.startsWith('A1') && v.includes('2 dishes (own count)'))).toBe(true);
    expect(cells.some((v) => typeof v === 'string' && v.startsWith('A2') && v.includes('1 dish'))).toBe(true);
    // 2 dishes: 18 µl PEI + 300 µl OptiMEM; 1 dish: 9 + 150
    expect(cells).toContain(roundUl(318));
    expect(cells).toContain(roundUl(159));
  });

  it('no longer tells the bench to add an equal volume to every tube', () => {
    expect(flat(setup).some((v) => typeof v === 'string' && v.includes('equal volume'))).toBe(false);
  });
});
