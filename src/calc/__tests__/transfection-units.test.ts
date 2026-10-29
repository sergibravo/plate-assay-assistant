import { describe, expect, it } from 'vitest';
import { computeCondition, computeGrid, masterMix, perCondition, unitRecipe, validateParams } from '../transfection';
import { defaultDish, DISH_DEFAULTS, type DnaStock, type TransfectionCondition, type TransfectionParams } from '../types';
import { migrate, newProject, PROJECT_VERSION } from '../../state/project';

/**
 * Dishes and per-condition counts. Every expected value here was worked out by hand from the
 * lab's numbers, not read back from the code.
 */
const PLATE: TransfectionParams = {
  mode: 'plate',
  cellLine: 'HEK293 parental',
  dish: defaultDish('6 cm'),
  wellsPerCondition: 12,
  dna_ng_per_well: 100,
  optimem_ul_per_well: 10,
  peiDnaRatio: 3,
  transfectionMixExtra_ul: 0,
  cellSuspensionExtra_ul: 0,
  cells_k_per_well: 30,
  dmem_ul_per_well: 100,
  plateFormat: '96-well',
  optimemMode: 'fixed',
  pei_ug_per_ul: 1,
  optimemLot: '',
  peiLot: '',
};
const DISH: TransfectionParams = { ...PLATE, mode: 'dish' };

const STOCKS: DnaStock[] = [
  { id: 'hibit', plasmidId: '', name: 'HiBiT-AT1R', stockConc_ng_per_ul: 10, notes: '', isFiller: false },
  { id: 'pcdna', plasmidId: '', name: 'pcDNA', stockConc_ng_per_ul: 1000, notes: '', isFiller: true },
];

const cond = (code: string, own: { wells?: number | null; dishes?: number | null } = {}): TransfectionCondition => ({
  id: code,
  code,
  label: '',
  entries: [
    { dnaStockId: 'hibit', pct: 0.5 },
    { dnaStockId: 'pcdna', pct: null },
  ],
  wells: own.wells ?? null,
  dishes: own.dishes ?? null,
});

describe('dish defaults', () => {
  it('6 cm is the lab reference: 3 µg DNA, 150 + 150 µl OptiMEM, 1.2 M cells, 3 ml DMEM', () => {
    expect(DISH_DEFAULTS['6 cm']).toEqual({ dna_ug: 3, optimemForDna_ul: 150, optimemForPei_ul: 150, cells_M: 1.2, medium_ml: 3 });
  });
  it('6-well (per well) and 10 cm', () => {
    expect(DISH_DEFAULTS['6-well']).toEqual({ dna_ug: 1.5, optimemForDna_ul: 75, optimemForPei_ul: 75, cells_M: 0.5, medium_ml: 2 });
    expect(DISH_DEFAULTS['10 cm']).toEqual({ dna_ug: 8, optimemForDna_ul: 400, optimemForPei_ul: 400, cells_M: 3, medium_ml: 5 });
  });
  it('no extra by default', () => {
    expect(defaultDish('10 cm').mixExtra_ul).toBe(0);
    expect(defaultDish('10 cm').cellExtra_ul).toBe(0);
  });
});

describe('one 6 cm dish', () => {
  const r = perCondition(DISH);
  it('is one dish by default', () => expect(r.units).toBe(1));
  it('3 µg DNA', () => expect(r.totalDna_ng).toBe(3000));
  it('PEI 3:1 from a 1 µg/µl stock = 9 µl', () => expect(r.pei_ul).toBeCloseTo(9, 12));
  it('150 µl OptiMEM in each tube', () => {
    expect(r.optimemForDna_ul).toBe(150);
    expect(r.optimemForPei_ul).toBe(150);
  });
  it('159 µl of PEI mix goes into the DNA tube', () => expect(r.peiMix_ul).toBeCloseTo(159, 12));
  it('1.2 M cells in 3 ml', () => {
    expect(r.cells_k).toBeCloseTo(1200, 9);
    expect(r.dmem_ul).toBe(3000);
  });
  it('10 cm: 8 µg DNA → 24 µl PEI; 6-well: 1.5 µg → 4.5 µl', () => {
    expect(perCondition({ ...DISH, dish: defaultDish('10 cm') }).pei_ul).toBeCloseTo(24, 12);
    expect(perCondition({ ...DISH, dish: defaultDish('6-well') }).pei_ul).toBeCloseTo(4.5, 12);
  });
  it('the ratio and stock still apply: 2:1 from 0.5 µg/µl = 12 µl', () => {
    expect(perCondition({ ...DISH, peiDnaRatio: 2, pei_ug_per_ul: 0.5 }).pei_ul).toBeCloseTo(12, 12);
  });
});

describe('dishes per condition', () => {
  it('a condition on 2 dishes gets twice the DNA mix, PEI mix and cells', () => {
    const r = computeCondition(DISH, cond('A1', { dishes: 2 }), STOCKS);
    expect(r.units).toBe(2);
    expect(r.unitsOverridden).toBe(true);
    expect(r.totalNg).toBeCloseTo(6000, 9);
    // HiBiT 0.5 % of 6000 ng = 30 ng → 3 µl of the 10 ng/µl stock
    expect(r.rows[0].ng).toBeCloseTo(30, 9);
    expect(r.rows[0].ul).toBeCloseTo(3, 9);
    expect(r.optimemForDna_ul).toBe(300);
    expect(r.peiMix_ul).toBeCloseTo(318, 9);
    expect(r.cellSuspension_ul).toBe(6000);
    expect(r.cells_k).toBeCloseTo(2400, 9);
  });

  it('the master mix is sized from the dishes, not the conditions: 1 + 1 + 2 = 4 dishes', () => {
    const grid = computeGrid(DISH, { cols: 3, rowGroups: 1, colLabels: [], rowGroupLabels: [], conditions: [[cond('A1'), cond('A2'), cond('A3', { dishes: 2 })]] }, STOCKS);
    expect(grid.activeUnits).toEqual([1, 1, 2]);
    const m = masterMix(DISH, grid.activeUnits);
    expect(m.nConditions).toBe(3);
    expect(m.totalUnits).toBe(4);
    expect(m.totalPei_ul).toBeCloseTo(36, 9);
    expect(m.totalOptimemForPei_ul).toBe(600);
    expect(m.dmemTotal_ul).toBeCloseTo(12000, 9);
    expect(m.totalCells_k).toBeCloseTo(4800, 9);
  });

  it('dish extras work like the plate ones: one spare dish of mix and suspension', () => {
    const m = masterMix({ ...DISH, dish: { ...defaultDish('6 cm'), mixExtra_ul: 159, cellExtra_ul: 3000 } }, [1, 1, 2]);
    expect(m.totalPei_ul).toBeCloseTo(36 + 9, 9);
    expect(m.totalOptimemForPei_ul).toBe(600 + 150);
    expect(m.dmemTotal_ul).toBeCloseTo(15000, 9);
    expect(m.totalCells_k).toBeCloseTo(6000, 9);
  });

  it('dish mode ignores the plate extras', () => {
    const m = masterMix({ ...DISH, transfectionMixExtra_ul: 500, cellSuspensionExtra_ul: 5000 }, [1]);
    expect(m.totalPei_ul).toBeCloseTo(9, 9);
    expect(m.dmemTotal_ul).toBeCloseTo(3000, 9);
  });
});

describe('wells per condition on the plate', () => {
  it('a 32-well condition: 3.2 µg DNA, 9.6 µl PEI, 160 µl OptiMEM each side', () => {
    const r = computeCondition(PLATE, cond('A1', { wells: 32 }), STOCKS);
    expect(r.units).toBe(32);
    expect(r.totalNg).toBeCloseTo(3200, 9);
    expect(r.optimemForDna_ul).toBe(160);
    expect(r.peiMix_ul).toBeCloseTo(9.6 + 160, 9);
    expect(r.cellSuspension_ul).toBe(3200);
    expect(r.cells_k).toBeCloseTo(960, 9);
  });

  it('every well still gets the same mix, whatever the condition size', () => {
    const big = computeCondition(PLATE, cond('A1', { wells: 32 }), STOCKS);
    const small = computeCondition(PLATE, cond('A2', { wells: 8 }), STOCKS);
    expect(big.totalNg / 32).toBeCloseTo(small.totalNg / 8, 12);
    expect(big.peiMix_ul / 32).toBeCloseTo(small.peiMix_ul / 8, 12);
    expect(big.optimemForDna_ul / 32).toBeCloseTo(small.optimemForDna_ul / 8, 12);
  });

  it('without an override a condition takes the default 12', () => {
    const r = computeCondition(PLATE, cond('A1'), STOCKS);
    expect(r.units).toBe(12);
    expect(r.unitsOverridden).toBe(false);
  });

  it('32 + 8 + 12 wells = 52 wells of master mix and cells', () => {
    const m = masterMix(PLATE, [32, 8, 12]);
    expect(m.totalUnits).toBe(52);
    expect(m.totalPei_ul).toBeCloseTo(15.6, 9);
    expect(m.totalOptimemForPei_ul).toBe(260);
    expect(m.dmemTotal_ul).toBeCloseTo(5200, 9);
    expect(m.totalCells_k).toBeCloseTo(1560, 9);
  });

  it('a small condition warns when a plasmid drops below the pipetting minimum', () => {
    // 0.5 % of 8 × 100 ng = 4 ng → 0.4 µl of the 10 ng/µl stock
    const r = computeCondition(PLATE, cond('A1', { wells: 8 }), STOCKS);
    expect(r.rows[0].ul).toBeCloseTo(0.4, 9);
    expect(r.warnings.map((w) => w.code)).toContain('below-min-pipette');
  });

  it('rejects a count that is not a whole number of at least 1', () => {
    for (const wells of [0, 2.5, -4]) {
      expect(computeCondition(PLATE, cond('A1', { wells }), STOCKS).warnings.map((w) => w.code)).toContain('units');
    }
  });
});

describe('switching mode never mixes up the two counts', () => {
  it('a 32-well override is not read as 32 dishes', () => {
    expect(computeCondition(DISH, cond('A1', { wells: 32 }), STOCKS).units).toBe(1);
  });
  it('a 2-dish override is not read as 2 wells', () => {
    expect(computeCondition(PLATE, cond('A1', { dishes: 2 }), STOCKS).units).toBe(12);
  });
  it('the recipe follows the mode', () => {
    expect(unitRecipe(PLATE).unit).toBe('well');
    expect(unitRecipe(DISH).unit).toBe('dish');
  });
});

describe('validation follows the mode', () => {
  it('dish mode does not complain about a plate field', () => {
    expect(validateParams({ ...DISH, wellsPerCondition: 0 }).map((w) => w.code)).not.toContain('wells');
  });
  it('a dish with no medium is an error', () => {
    expect(validateParams({ ...DISH, dish: { ...defaultDish(), medium_ml: 0 } }).map((w) => w.code)).toContain('medium');
  });
});

describe('older files', () => {
  it('open as plate transfections, every condition at the default count', () => {
    const p = newProject();
    const old: any = JSON.parse(JSON.stringify({ ...p, version: 6 }));
    delete old.transfection.mode;
    delete old.transfection.dish;
    delete old.transfection.cellLine;
    old.grid.conditions.forEach((row: any[]) => row.forEach((c) => { delete c.wells; delete c.dishes; }));
    const m = migrate(old);
    expect(m.version).toBe(PROJECT_VERSION);
    expect(m.transfection.mode).toBe('plate');
    expect(m.transfection.cellLine).toBe('');
    expect(m.transfection.dish).toEqual(defaultDish('6 cm'));
    expect(m.grid.conditions.flat().every((c) => c.wells === null && c.dishes === null)).toBe(true);
  });
  it('a new project is a plate transfection of HEK293 parental cells', () => {
    const p = newProject();
    expect(p.transfection.mode).toBe('plate');
    expect(p.transfection.cellLine).toBe('HEK293 parental');
  });
});
