import { describe, expect, it } from 'vitest';
import {
  computeCondition,
  computeGrid,
  fillerPct,
  masterMix,
  perCondition,
  validateParams,
} from '../transfection';
import { defaultDish, PLATE_GEOMETRY, type DnaStock, type TransfectionCondition, type TransfectionParams } from '../types';

/**
 * Reference values are the *computed* cell values stored in
 * `260821_hibit_transfection_optimisation_dilutions_template.xlsx`.
 */
const SHEET_PARAMS: TransfectionParams = {
  mode: 'plate',
  cellLine: '',
  dish: defaultDish(),
  wellsPerCondition: 12, // Setup!C4
  dna_ng_per_well: 100, // Setup!C5
  optimem_ul_per_well: 10, // Setup!C6
  peiDnaRatio: 3, // Setup!C7
  // The sheet's 1.2× margin over 8 conditions, expressed as the amounts it stood for.
  transfectionMixExtra_ul: (3.6 + 60) * 8 * 0.2, // 101.76 µl of PEI+OptiMEM mix
  cellSuspensionExtra_ul: 100 * 12 * 8 * 0.2, // 1920 µl of suspension
  cells_k_per_well: 30, // Setup!F4 (sheet stored 0.03 M = 30 k)
  dmem_ul_per_well: 100, // Setup!F5
  plateFormat: '96-well',
  optimemMode: 'fixed',
  pei_ug_per_ul: 1, // Setup!I4
  optimemLot: '',
  peiLot: '',
};

const STOCKS: DnaStock[] = [
  { id: 'hibit', plasmidId: 'pEK101', name: 'HiBiT-AT1R', stockConc_ng_per_ul: 10, notes: 'Receptor', isFiller: false },
  { id: 'arr3', plasmidId: 'pEK202', name: 'arr3', stockConc_ng_per_ul: 79, notes: 'LgBiT anchor', isFiller: false },
  { id: 'smbit', plasmidId: '', name: 'SmBiT sensor', stockConc_ng_per_ul: null, notes: '', isFiller: false },
  { id: 'pcdna', plasmidId: 'pEK001', name: 'pcDNA', stockConc_ng_per_ul: 1000, notes: 'filler', isFiller: true },
];

describe('Setup sheet — per condition (acceptance test 1)', () => {
  const r = perCondition(SHEET_PARAMS);

  it('Total DNA / condition = 1200 ng (Setup!C23)', () => expect(r.totalDna_ng).toBe(1200));
  it('Total DNA is not scaled by any extra (Setup!C24 was reference only)', () => {
    expect(r.totalDnaWithMargin_ng).toBe(1200);
  });
  it('PEI / condition = 3.6 µl (Setup!C25)', () => expect(r.pei_ul).toBeCloseTo(3.6, 12));
  it('OptiMEM for DNA = 60 µl (Setup!C26)', () => expect(r.optimemForDna_ul).toBe(60));
  it('OptiMEM for PEI = 60 µl (Setup!C27)', () => expect(r.optimemForPei_ul).toBe(60));
  it('DMEM / condition = 1200 µl (Setup!C28)', () => expect(r.dmem_ul).toBe(1200));
  it('Cells / condition = 360 k = 0.36 M (Setup!C29)', () => {
    expect(r.cells_k).toBeCloseTo(360, 9);
    expect(r.cells_k / 1000).toBeCloseTo(0.36, 12);
  });
});

describe('PEI Mix sheet — master mix over 8 conditions', () => {
  const m = masterMix(SHEET_PARAMS, 8);

  it('PEI per condition = 3.6 µl (PEI Mix!C5)', () => expect(m.peiPerCondition_ul).toBeCloseTo(3.6, 12));
  it('Total PEI = 34.56 µl (PEI Mix!C6)', () => expect(m.totalPei_ul).toBeCloseTo(34.56, 10));
  it('OptiMEM for PEI / condition = 60 µl (PEI Mix!C7)', () => expect(m.optimemForPeiPerCondition_ul).toBe(60));
  it('Total OptiMEM for PEI = 576 µl (PEI Mix!C8)', () => expect(m.totalOptimemForPei_ul).toBeCloseTo(576, 10));
  it('DMEM total = 11520 µl (PEI Mix!F4)', () => expect(m.dmemTotal_ul).toBeCloseTo(11520, 9));
  it('Total cells = 3456 k = 3.456 M (PEI Mix!F5)', () => {
    expect(m.totalCells_k).toBeCloseTo(3456, 9);
    expect(m.totalCells_k / 1000).toBeCloseTo(3.456, 12);
  });
  it('Cell suspension / condition = 1200 µl (PEI Mix!F6)', () => expect(m.cellSuspensionPerCondition_ul).toBe(1200));
});

describe('DNA Mixes sheet — condition A2 "low hibit"', () => {
  const condition: TransfectionCondition = {
    id: 'c1',
    code: 'A2',
    label: 'low hibit',
    wells: null,
    dishes: null,
    entries: [
      { dnaStockId: 'hibit', pct: 0.5 },
      { dnaStockId: 'arr3', pct: 0 },
      { dnaStockId: 'smbit', pct: null },
      { dnaStockId: 'pcdna', pct: null }, // filler — computed
    ],
  };
  const r = computeCondition(SHEET_PARAMS, condition, STOCKS);

  it('0.5 % of 1200 ng = 6 ng (DNA Mixes!J11)', () => {
    expect(r.rows[0].ng).toBeCloseTo(6, 12);
  });
  it('6 ng / 10 ng/µl = 0.6 µl (DNA Mixes!K11)', () => {
    expect(r.rows[0].ul).toBeCloseTo(0.6, 12);
  });
  it('filler tops up to 99.5 % → 1194 ng → 1.194 µl (DNA Mixes!I14/J14/K14)', () => {
    const filler = r.rows[3];
    expect(filler.pct).toBeCloseTo(99.5, 12);
    expect(filler.ng).toBeCloseTo(1194, 10);
    expect(filler.ul).toBeCloseTo(1.194, 12);
    expect(filler.pctIsComputed).toBe(true);
  });
  it('unknown stock concentration yields null (rendered "—", DNA Mixes!K13)', () => {
    expect(r.rows[2].ul).toBeNull();
  });
  it('totals: 100 %, 1200 ng, 1.794 µl (DNA Mixes!I19/J19/K19)', () => {
    expect(r.totalPct).toBeCloseTo(100, 12);
    expect(r.totalNg).toBeCloseTo(1200, 10);
    expect(r.totalUl).toBeCloseTo(1.794, 12);
  });
  it('composition check = ✓ OK (DNA Mixes!H20)', () => expect(r.pctOk).toBe(true));
  it('OptiMEM for this tube = 60 µl (DNA Mixes!J20 → Setup!C26)', () => {
    expect(r.optimemForDna_ul).toBe(60);
  });
});

describe('DNA mix edge cases', () => {
  it('filler = MAX(0, 100 − Σ others), never negative', () => {
    expect(fillerPct([0.5, 0, null])).toBeCloseTo(99.5, 12);
    expect(fillerPct([60, 60])).toBe(0);
    expect(fillerPct([])).toBe(100);
  });

  it('a block with no user-entered % is empty and stays hidden', () => {
    const empty: TransfectionCondition = {
      id: 'c0',
      code: 'A5',
      label: '',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'hibit', pct: null },
        { dnaStockId: 'pcdna', pct: null },
      ],
    };
    const r = computeCondition(SHEET_PARAMS, empty, STOCKS);
    expect(r.isEmpty).toBe(true);
    expect(r.rows.every((row) => row.pct === 0)).toBe(true);
  });

  it('flags a composition that cannot reach 100 %', () => {
    const over: TransfectionCondition = {
      id: 'c2',
      code: 'A1',
      label: 'over',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'hibit', pct: 60 },
        { dnaStockId: 'arr3', pct: 60 },
        { dnaStockId: 'pcdna', pct: null },
      ],
    };
    const r = computeCondition(SHEET_PARAMS, over, STOCKS);
    expect(r.pctOk).toBe(false);
    expect(r.warnings.some((w) => w.code === 'pct-not-100')).toBe(true);
  });

  it('warns below the 0.5 µl pipetting minimum', () => {
    const tiny: TransfectionCondition = {
      id: 'c3',
      code: 'A1',
      label: 'tiny',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'arr3', pct: 1 }, // 12 ng / 79 ng/µl = 0.152 µl
        { dnaStockId: 'pcdna', pct: null },
      ],
    };
    const r = computeCondition(SHEET_PARAMS, tiny, STOCKS);
    expect(r.warnings.some((w) => w.code === 'below-min-pipette')).toBe(true);
  });

  it('warns when DNA volume exceeds the OptiMEM in the tube', () => {
    const dilute: DnaStock[] = [
      { id: 'weak', plasmidId: '', name: 'weak prep', stockConc_ng_per_ul: 5, notes: '', isFiller: false },
      { id: 'pcdna', plasmidId: '', name: 'pcDNA', stockConc_ng_per_ul: 1000, notes: '', isFiller: true },
    ];
    const c: TransfectionCondition = {
      id: 'c4',
      code: 'A1',
      label: 'bulky',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'weak', pct: 100 }, // 1200 ng / 5 = 240 µl > 60 µl OptiMEM
        { dnaStockId: 'pcdna', pct: null },
      ],
    };
    const r = computeCondition(SHEET_PARAMS, c, dilute);
    expect(r.warnings.some((w) => w.code === 'dna-exceeds-optimem')).toBe(true);
  });
});

describe('grid + parameter validation', () => {
  it('counts only non-empty blocks as active conditions', () => {
    const mk = (code: string, pct: number | null): TransfectionCondition => ({
      id: code,
      code,
      label: '',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'hibit', pct },
        { dnaStockId: 'pcdna', pct: null },
      ],
    });
    const grid = {
      cols: 2,
      rowGroups: 1,
      colLabels: ['x', 'y'],
      rowGroupLabels: ['g'],
      conditions: [[mk('A1', 1), mk('A2', null)]],
    };
    const r = computeGrid(SHEET_PARAMS, grid, STOCKS);
    expect(r.activeCount).toBe(1);
  });

  it('accepts the reference setup without errors', () => {
    expect(validateParams(SHEET_PARAMS).filter((w) => w.level === 'error')).toHaveLength(0);
  });

  it('rejects nonsense parameters', () => {
    const bad = { ...SHEET_PARAMS, wellsPerCondition: 0, pei_ug_per_ul: 0 };
    const codes = validateParams(bad).map((w) => w.code);
    expect(codes).toContain('wells');
    expect(codes).toContain('pei-stock');
  });
});

describe('filler-only control condition (the sheet\'s "no receptor" block)', () => {
  it('an explicit 0 % on every non-filler DNA makes a 100 % filler block that still counts', () => {
    const control: TransfectionCondition = {
      id: 'ctrl',
      code: 'A1',
      label: 'no receptor',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'hibit', pct: 0 },
        { dnaStockId: 'arr3', pct: 0 },
        { dnaStockId: 'smbit', pct: 0 },
        { dnaStockId: 'pcdna', pct: null },
      ],
    };
    const r = computeCondition(SHEET_PARAMS, control, STOCKS);
    expect(r.isEmpty).toBe(false);
    expect(r.rows[3].pct).toBe(100);
    expect(r.rows[3].ng).toBeCloseTo(1200, 9);
    expect(r.rows[3].ul).toBeCloseTo(1.2, 12);
    expect(r.pctOk).toBe(true);
  });
});

describe('OptiMEM mode', () => {
  const condition: TransfectionCondition = {
    id: 'c',
    code: 'A2',
    label: 'low hibit',
    wells: null,
    dishes: null,
    entries: [
      { dnaStockId: 'hibit', pct: 0.5 }, // 6 ng / 10 = 0.6 µl
      { dnaStockId: 'pcdna', pct: null }, // filler 99.5 % → 1194 ng / 1000 = 1.194 µl
    ],
  };

  it('fixed mode adds the full OptiMEM volume, as the sheet does', () => {
    const r = computeCondition(SHEET_PARAMS, condition, STOCKS);
    expect(r.optimemForDna_ul).toBe(60);
    expect(r.totalUl).toBeCloseTo(1.794, 12);
    expect(r.tubeTotal_ul).toBeCloseTo(61.794, 12);
  });

  it('final-volume mode subtracts the DNA already in the tube', () => {
    const r = computeCondition({ ...SHEET_PARAMS, optimemMode: 'final-volume' }, condition, STOCKS);
    expect(r.optimemTarget_ul).toBe(60);
    expect(r.optimemForDna_ul).toBeCloseTo(58.206, 12); // 60 − 1.794
    expect(r.tubeTotal_ul).toBeCloseTo(60, 12);
  });

  it('final-volume mode never asks for a negative volume, and says why', () => {
    const bulky: DnaStock[] = [
      { id: 'weak', plasmidId: '', name: 'weak prep', stockConc_ng_per_ul: 5, notes: '', isFiller: false },
      { id: 'pcdna', plasmidId: '', name: 'pcDNA', stockConc_ng_per_ul: 1000, notes: '', isFiller: true },
    ];
    const c: TransfectionCondition = {
      id: 'c2',
      code: 'A1',
      label: '',
      wells: null,
      dishes: null,
      entries: [
        { dnaStockId: 'weak', pct: 100 }, // 1200 ng / 5 = 240 µl > 60 µl target
        { dnaStockId: 'pcdna', pct: null },
      ],
    };
    const r = computeCondition({ ...SHEET_PARAMS, optimemMode: 'final-volume' }, c, bulky);
    expect(r.optimemForDna_ul).toBe(0);
    expect(r.warnings.some((w) => w.code === 'dna-exceeds-optimem')).toBe(true);
  });

  it('warns when the leftover OptiMEM is too small to pipette', () => {
    const tight = { ...SHEET_PARAMS, optimem_ul_per_well: 0.3, optimemMode: 'final-volume' as const };
    // target = 0.3 × 12 / 2 = 1.8 µl; DNA takes 1.794 µl → 0.006 µl left
    const r = computeCondition(tight, condition, STOCKS);
    expect(r.warnings.some((w) => w.code === 'optimem-below-min-pipette')).toBe(true);
  });
});

describe('plate formats', () => {
  it('half-area 96-well shares the 8 × 12 footprint', () => {
    expect(PLATE_GEOMETRY['half-area 96-well']).toEqual(PLATE_GEOMETRY['96-well']);
    expect(PLATE_GEOMETRY['384-well'].rows * PLATE_GEOMETRY['384-well'].cols).toBe(384);
  });
});

describe('extra volumes rather than margins', () => {
  it('extra mix is split in the ratio of the mix itself', () => {
    const m = masterMix({ ...SHEET_PARAMS, transfectionMixExtra_ul: 636 }, 8);
    // 8 conditions need 28.8 µl PEI + 480 µl OptiMEM; 636 µl extra keeps that ratio
    const peiShare = 3.6 / (3.6 + 60);
    expect(m.totalPei_ul).toBeCloseTo(3.6 * 8 + 636 * peiShare, 9);
    expect(m.totalOptimemForPei_ul).toBeCloseTo(60 * 8 + 636 * (1 - peiShare), 9);
    expect(m.totalPei_ul + m.totalOptimemForPei_ul).toBeCloseTo((3.6 + 60) * 8 + 636, 9);
  });

  it('extra suspension carries its own cells at the seeding density', () => {
    const m = masterMix({ ...SHEET_PARAMS, cellSuspensionExtra_ul: 2000 }, 8);
    expect(m.dmemTotal_ul).toBeCloseTo(100 * 12 * 8 + 2000, 9);
    // 30 k cells per 100 µl → 600 k extra cells in 2000 µl
    expect(m.totalCells_k).toBeCloseTo(30 * 12 * 8 + 600, 9);
  });

  it('the two extras are independent', () => {
    const m = masterMix({ ...SHEET_PARAMS, transfectionMixExtra_ul: 0, cellSuspensionExtra_ul: 5000 }, 8);
    expect(m.totalPei_ul).toBeCloseTo(28.8, 9);
    expect(m.dmemTotal_ul).toBeCloseTo(9600 + 5000, 9);
  });

  it('reproduces the sheet when the extras stand for its 1.2× margin', () => {
    const m = masterMix(SHEET_PARAMS, 8);
    expect(m.totalPei_ul).toBeCloseTo(34.56, 9);
    expect(m.totalOptimemForPei_ul).toBeCloseTo(576, 9);
    expect(m.dmemTotal_ul).toBeCloseTo(11520, 9);
    expect(m.totalCells_k).toBeCloseTo(3456, 9);
  });

  it('rejects a negative extra', () => {
    const codes = validateParams({ ...SHEET_PARAMS, cellSuspensionExtra_ul: -10 }).map((w) => w.code);
    expect(codes).toContain('cell-extra');
  });
});

describe('OptiMEM comes out in whole µl', () => {
  it('a split that lands on decimals is rounded up for the diluent, not the PEI', () => {
    const m = masterMix({ ...SHEET_PARAMS, transfectionMixExtra_ul: 250 }, 8);
    expect(Number.isInteger(m.totalOptimemForPei_ul)).toBe(true);
    // 480 + 250 × (60/63.6) = 715.85 → 716
    expect(m.totalOptimemForPei_ul).toBe(716);
    // the PEI keeps its precision, because the ratio depends on it
    expect(m.totalPei_ul).toBeCloseTo(3.6 * 8 + 250 * (3.6 / 63.6), 9);
    expect(Number.isInteger(m.totalPei_ul)).toBe(false);
  });

  it('never rounds down, so the mix is never short', () => {
    for (const extra of [0, 1, 37, 101.76, 999.9]) {
      const m = masterMix({ ...SHEET_PARAMS, transfectionMixExtra_ul: extra }, 5);
      const raw = 60 * 5 + extra * (60 / 63.6);
      expect(m.totalOptimemForPei_ul).toBeGreaterThanOrEqual(raw - 1e-9);
      expect(m.totalOptimemForPei_ul - raw).toBeLessThan(1);
    }
  });

  it('leaves a whole figure alone', () => {
    const m = masterMix(SHEET_PARAMS, 8); // the sheet's own case
    expect(m.totalOptimemForPei_ul).toBe(576);
  });
});
