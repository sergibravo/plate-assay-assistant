/**
 * Project = one experiment file. Everything the app knows lives here, and the whole
 * thing round-trips through a single JSON file (File → Save / Open) plus a
 * localStorage autosave for convenience. No server, no database.
 */

import type { CompoundBlock, DilutionExperiment } from '../calc/dilutions';
import { defaultSubstrate } from '../calc/substrate';
import type {
  Compound,
  DnaMixGrid,
  DnaStock,
  TransfectionCondition,
  TransfectionParams,
} from '../calc/types';

export const PROJECT_VERSION = 3 as const;

export interface Project {
  version: typeof PROJECT_VERSION;
  name: string;
  createdAt: string;
  updatedAt: string;
  transfection: TransfectionParams;
  dnaStocks: DnaStock[];
  grid: DnaMixGrid;
  /** Reusable compound inventory (module 3). */
  compounds: Compound[];
  /** Module 3 — serial dilutions and DMSO matching. */
  dilutions: DilutionExperiment;
  notes: string;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Column letter for Dim A (1 → "A1" style codes use the row-group letter, see below). */
const ROW_GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Condition code as the sheet writes it: row-group letter + column number, e.g. "A2", "C1". */
export function conditionCode(rowGroup: number, col: number): string {
  return `${ROW_GROUP_LETTERS[rowGroup] ?? `R${rowGroup + 1}`}${col + 1}`;
}

export function emptyCondition(rowGroup: number, col: number, stocks: DnaStock[]): TransfectionCondition {
  return {
    id: uid('cond'),
    code: conditionCode(rowGroup, col),
    label: '',
    entries: stocks.map((s) => ({ dnaStockId: s.id, pct: null })),
  };
}

/**
 * Keep every condition's DNA rows in step with the inventory: add rows for new
 * stocks, drop rows for deleted ones, preserve order and any % already typed.
 */
export function reconcileGrid(grid: DnaMixGrid, stocks: DnaStock[]): DnaMixGrid {
  const conditions = grid.conditions.map((row, rg) =>
    row.map((c, col) => {
      const byId = new Map(c.entries.map((e) => [e.dnaStockId, e.pct]));
      return {
        ...c,
        code: conditionCode(rg, col),
        entries: stocks.map((s) => ({ dnaStockId: s.id, pct: byId.get(s.id) ?? null })),
      };
    }),
  );
  return { ...grid, conditions };
}

/** Grow or shrink the grid to `cols` × `rowGroups`, keeping existing content. */
export function resizeGrid(grid: DnaMixGrid, rowGroups: number, cols: number, stocks: DnaStock[]): DnaMixGrid {
  const conditions: TransfectionCondition[][] = [];
  for (let rg = 0; rg < rowGroups; rg++) {
    const row: TransfectionCondition[] = [];
    for (let col = 0; col < cols; col++) {
      row.push(grid.conditions[rg]?.[col] ?? emptyCondition(rg, col, stocks));
    }
    conditions.push(row);
  }
  const colLabels = Array.from({ length: cols }, (_, i) => grid.colLabels[i] ?? `Condition ${i + 1}`);
  const rowGroupLabels = Array.from({ length: rowGroups }, (_, i) => grid.rowGroupLabels[i] ?? `Group ${i + 1}`);
  return reconcileGrid({ cols, rowGroups, colLabels, rowGroupLabels, conditions }, stocks);
}


/** Insert a column (Dim A) at `at`, or append when `at` is omitted. */
export function addColumn(grid: DnaMixGrid, stocks: DnaStock[], at = grid.cols): DnaMixGrid {
  const conditions = grid.conditions.map((row, rg) => {
    const next = [...row];
    next.splice(at, 0, emptyCondition(rg, at, stocks));
    return next;
  });
  const colLabels = [...grid.colLabels];
  colLabels.splice(at, 0, '');
  return reconcileGrid({ ...grid, cols: grid.cols + 1, colLabels, conditions }, stocks);
}

export function removeColumn(grid: DnaMixGrid, stocks: DnaStock[], at: number): DnaMixGrid {
  if (grid.cols <= 1) return grid;
  const conditions = grid.conditions.map((row) => row.filter((_, i) => i !== at));
  const colLabels = grid.colLabels.filter((_, i) => i !== at);
  return reconcileGrid({ ...grid, cols: grid.cols - 1, colLabels, conditions }, stocks);
}

/** Insert a row group (Dim B) at `at`, or append when `at` is omitted. */
export function addRowGroup(grid: DnaMixGrid, stocks: DnaStock[], at = grid.rowGroups): DnaMixGrid {
  const conditions = [...grid.conditions];
  conditions.splice(at, 0, Array.from({ length: grid.cols }, (_, col) => emptyCondition(at, col, stocks)));
  const rowGroupLabels = [...grid.rowGroupLabels];
  rowGroupLabels.splice(at, 0, '');
  return reconcileGrid({ ...grid, rowGroups: grid.rowGroups + 1, rowGroupLabels, conditions }, stocks);
}

export function removeRowGroup(grid: DnaMixGrid, stocks: DnaStock[], at: number): DnaMixGrid {
  if (grid.rowGroups <= 1) return grid;
  const conditions = grid.conditions.filter((_, i) => i !== at);
  const rowGroupLabels = grid.rowGroupLabels.filter((_, i) => i !== at);
  return reconcileGrid({ ...grid, rowGroups: grid.rowGroups - 1, rowGroupLabels, conditions }, stocks);
}

/** Map over one condition of the grid. */
export function updateCondition(
  grid: DnaMixGrid,
  conditionId: string,
  fn: (c: TransfectionCondition) => TransfectionCondition,
): DnaMixGrid {
  return {
    ...grid,
    conditions: grid.conditions.map((row) => row.map((c) => (c.id === conditionId ? fn(c) : c))),
  };
}

/** Blank every % so the block reads as unused and disappears from the counts. */
export function clearCondition(c: TransfectionCondition): TransfectionCondition {
  return { ...c, entries: c.entries.map((e) => ({ ...e, pct: null })) };
}

/**
 * Turn an unused block into a filler-only control: every non-filler DNA set to an
 * explicit 0 %, which makes the filler top up to 100 % (the sheet's "no receptor" block).
 */
export function enableCondition(c: TransfectionCondition, stocks: DnaStock[]): TransfectionCondition {
  const fillerId = stocks.find((s) => s.isFiller)?.id ?? null;
  return {
    ...c,
    entries: c.entries.map((e) => ({ ...e, pct: e.dnaStockId === fillerId ? null : (e.pct ?? 0) })),
  };
}

/** A fresh compound block with room for a dose-response series. */
export function newCompoundBlock(name = '', rows = 8): CompoundBlock {
  return {
    id: uid('cmp'),
    name,
    volForWells_ul: 200,
    dilutionFactorOverride: null,
    stockConc_uM: 10000,
    vehicle: 'aqueous',
    margin: 1,
    excludeFromVehicleMatch: false,
    logM: Array.from({ length: rows }, () => null),
    stockBsaPct: null,
    notes: '',
  };
}

export function emptyDilutions(): DilutionExperiment {
  return {
    assayType: 'NanoBiT/BRET',
    dmsoOverride: null,
    addition: { compound_ul: 10, assayBuffer_ul: 80 },
    dmsoPlacement: 'compound-only',
    premixOverrides: { 'assay-buffer': null, normal: null, dmso: null, well: null, substrate: null },
    substrate: defaultSubstrate('NanoBiT/BRET'),
    blocks: [newCompoundBlock('Compound 1')],
    bsa: { enabled: false, targetPct: 0.01, stockPct: 5, placement: 'all-buffers' },
    bufferNotes: '',
  };
}

/** A new project pre-loaded with the reference experiment's parameters. */
export function newProject(name = 'Untitled experiment'): Project {
  const now = new Date().toISOString();
  const dnaStocks: DnaStock[] = [
    { id: uid('dna'), plasmidId: '', name: 'HiBiT-AT1R', stockConc_ng_per_ul: 10, notes: 'Receptor', isFiller: false },
    { id: uid('dna'), plasmidId: '', name: 'arr3', stockConc_ng_per_ul: 79, notes: 'LgBiT membrane anchor', isFiller: false },
    { id: uid('dna'), plasmidId: '', name: 'pcDNA', stockConc_ng_per_ul: 1000, notes: 'Empty vector / filler', isFiller: true },
  ];
  const transfection: TransfectionParams = {
    wellsPerCondition: 12,
    dna_ng_per_well: 100,
    optimem_ul_per_well: 10,
    peiDnaRatio: 3,
    margin: 1.2,
    cells_k_per_well: 30,
    dmem_ul_per_well: 100,
    plateFormat: '96-well',
    optimemMode: 'fixed',
    pei_ug_per_ul: 1,
    optimemLot: '',
    peiLot: '',
  };
  const grid = resizeGrid(
    { cols: 0, rowGroups: 0, colLabels: [], rowGroupLabels: [], conditions: [] },
    2,
    4,
    dnaStocks,
  );
  return {
    version: PROJECT_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    transfection,
    dnaStocks,
    grid,
    compounds: [],
    dilutions: emptyDilutions(),
    notes: '',
  };
}


/**
 * Bring an older project file up to the current shape. Runs on every open and on the
 * localStorage autosave, so a file saved before a model change still works.
 */
export function migrate(raw: any): Project {
  const p = { ...raw };
  if (p.version === 1) {
    // v1 stored cells per well in millions; v2 stores thousands.
    if (p.transfection && p.transfection.cells_M_per_well !== undefined) {
      p.transfection = {
        ...p.transfection,
        cells_k_per_well: p.transfection.cells_M_per_well * 1000,
      };
      delete p.transfection.cells_M_per_well;
    }
    p.version = 2;
  }
  if (p.version === 2) {
    // v3 adds the module 3 (dilutions) section.
    p.version = 3;
  }
  p.dnaStocks = (p.dnaStocks ?? []).map((s: any) => ({ plasmidId: '', notes: '', ...s }));
  // Fields added after a project was saved fall back to the previous behaviour.
  p.transfection = { optimemMode: 'fixed', ...p.transfection };
  // Note what the stored file actually had before defaults paper over it.
  const storedDilutions = p.dilutions ?? {};
  const hadAddition = storedDilutions.addition !== undefined;
  p.dilutions = { ...emptyDilutions(), ...storedDilutions };
  p.dilutions.bsa = { ...emptyDilutions().bsa, ...(p.dilutions.bsa ?? {}) };
  p.dilutions.premixOverrides = { ...emptyDilutions().premixOverrides, ...(p.dilutions.premixOverrides ?? {}) };
  p.dilutions.substrate = p.dilutions.substrate ?? defaultSubstrate(p.dilutions.assayType ?? 'NanoBiT/BRET');
  // The addition used to be split between a global in-well factor and a per-block dilution
  // factor; it is now one setting, expressed as the volumes actually pipetted.
  if (p.dilutions.inWellFactor !== undefined && !hadAddition) {
    const f = Number(p.dilutions.inWellFactor) || 2;
    p.dilutions.addition = { compound_ul: 10, assayBuffer_ul: 10 * (f - 1) };
    delete p.dilutions.inWellFactor;
  }
  // The well used to be "what is already in it" (assay buffer plus the substrate); it is now
  // the plain assay buffer alone, with the substrate carrying its own volume.
  if (p.dilutions.addition?.inWell_ul !== undefined) {
    const substrateVol = p.dilutions.substrate?.enabled ? Number(p.dilutions.substrate.volumePerWell_ul) || 0 : 0;
    p.dilutions.addition = {
      compound_ul: p.dilutions.addition.compound_ul,
      assayBuffer_ul: Math.max(0, p.dilutions.addition.inWell_ul - substrateVol),
    };
  }
  if (p.dilutions.substrate) {
    // Dilutions are quoted in the well now; a kit-recipe reference has no equivalent.
    if (p.dilutions.substrate.basis === 'prepared') delete p.dilutions.substrate.basis;
    if (p.dilutions.substrate.reference === 'as-prepared') p.dilutions.substrate.reference = 'after-compounds';
    delete p.dilutions.substrate.basis;
  }
  if (p.dilutions.bsa.basis !== undefined) {
    // 'in-well' meant the buffer was premixed that much stronger; carry the number over.
    if (p.dilutions.bsa.basis === 'in-well') {
      p.dilutions.bsa.targetPct *= 2;
    }
    p.dilutions.bsa.placement = 'compound-only';
    delete p.dilutions.bsa.basis;
  }
  p.dilutions.blocks = (p.dilutions.blocks ?? []).map((b: any) => {
    const block = { ...newCompoundBlock(), ...b };
    if (b.dilutionFactor !== undefined && b.dilutionFactorOverride === undefined) {
      block.dilutionFactorOverride = null; // the experiment's addition now governs
      delete (block as any).dilutionFactor;
    }
    return block;
  });
  p.compounds = p.compounds ?? [];
  p.notes = p.notes ?? '';
  return p as Project;
}

const STORAGE_KEY = 'plate-assay-assistant:project';

export function saveLocal(p: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota or private mode — the JSON file export is the real persistence */
  }
}

export function loadLocal(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = migrate(JSON.parse(raw));
    return parsed.version === PROJECT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function downloadProject(p: Project): void {
  const blob = new Blob([JSON.stringify({ ...p, updatedAt: new Date().toISOString() }, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, `${slug(p.name)}.assay.json`);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'experiment';
}
