/**
 * Module 2 — the plate.
 *
 * A well holds what is in it: cells (a transfection) and any number of treatments, because
 * an inhibitor and a ligand can share a well. Treatments are stored per well rather than as
 * column defaults — the plate is painted, and a painted plate is easier to reason about than
 * a set of defaults with exceptions. Transfections keep a row default, because a whole row
 * of one transfection is the common case, with per-well painting when it is not.
 *
 * Nothing here is retyped from elsewhere: the paints come from module 1's conditions and
 * module 3's dilution steps and buffer channels, and the wells painted with a step tell
 * module 3 how much of it to prepare.
 */

import { INHIBITOR_VEHICLE_PAINT, type DilutionExperiment } from './dilutions';
import { NEUTRAL, paletteColour, shade } from './palette';
import { logMToUM } from './units';
import { PLATE_GEOMETRY, type DnaMixGrid, type PlateFormat } from './types';

export interface WellState {
  /** Overrides the row's transfection. `null` means deliberately none. */
  transfectionId?: string | null;
  /** Treatment ids in the order they were painted. */
  treatments?: string[];
  notes?: string;
}

export interface PlateLayout {
  format: PlateFormat;
  /** Transfection per row — the usual case; a well can override it. */
  rowTransfection: (string | null)[];
  /** Time point per row, free text. */
  rowTime: string[];
  wells: Record<string, WellState>;
}

/** Something that can be painted. */
export interface Paint {
  id: string;
  label: string;
  /** For the well itself, where there is no room. */
  short: string;
  colour: string;
  kind: 'transfection' | 'compound' | 'channel' | 'inhibitor';
  /** Compounds only: which block and step, so the plate can size that step. */
  blockId?: string;
  stepIndex?: number;
}

export function wellId(rowLabel: string, col: number): string {
  return `${rowLabel}${col + 1}`;
}

export function emptyLayout(format: PlateFormat = '96-well'): PlateLayout {
  const g = PLATE_GEOMETRY[format];
  return {
    format,
    rowTransfection: Array.from({ length: g.rows }, () => null),
    rowTime: Array.from({ length: g.rows }, () => ''),
    wells: {},
  };
}

/** Keep what still fits when the plate format changes. */
export function reshapeLayout(layout: PlateLayout, format: PlateFormat): PlateLayout {
  const g = PLATE_GEOMETRY[format];
  return {
    format,
    rowTransfection: Array.from({ length: g.rows }, (_, i) => layout.rowTransfection[i] ?? null),
    rowTime: Array.from({ length: g.rows }, (_, i) => layout.rowTime[i] ?? ''),
    wells: Object.fromEntries(
      Object.entries(layout.wells).filter(([id]) => {
        const row = g.rowLabels.indexOf(id[0]);
        const col = Number(id.slice(1)) - 1;
        return row >= 0 && col >= 0 && col < g.cols;
      }),
    ),
  };
}

/** Conditions module 1 actually uses. */
export function transfectionPaints(grid: DnaMixGrid): Paint[] {
  return grid.conditions
    .flat()
    .filter((c) => c.entries.some((e) => e.pct !== null && e.pct !== undefined))
    .map((c, i) => ({
      id: c.id,
      label: c.label ? `${c.code} — ${c.label}` : c.code,
      short: c.code,
      colour: paletteColour(i),
      kind: 'transfection' as const,
    }));
}

function concentrationLabel(logM: number): string {
  const uM = logMToUM(logM);
  if (uM >= 1000) return `${+(uM / 1000).toFixed(3)} mM`;
  if (uM >= 1) return `${+uM.toFixed(3)} µM`;
  if (uM >= 0.001) return `${+(uM * 1000).toFixed(3)} nM`;
  return `${+(uM * 1e6).toFixed(3)} pM`;
}

/**
 * Every treatment module 3 offers. A compound's steps shade from its own colour — palest at
 * the most dilute — so a dose-response reads as a gradient on the plate.
 */
export function treatmentPaints(exp: DilutionExperiment): Paint[] {
  const paints: Paint[] = [];
  for (const block of exp.blocks) {
    const steps = block.logM
      .map((logM, index) => ({ logM, index }))
      .filter((s): s is { logM: number; index: number } => s.logM !== null && Number.isFinite(s.logM));
    // Rank 0 is the most dilute, so the palest colour is the lowest dose whichever way the
    // series was typed.
    const ordered = [...steps].sort((a, b) => a.logM - b.logM);
    steps.forEach((s) => {
      const rank = ordered.findIndex((o) => o.index === s.index);
      paints.push({
        id: `cmp:${block.id}:${s.index}`,
        label: `${block.name || 'compound'} ${concentrationLabel(s.logM)}`,
        short: concentrationLabel(s.logM),
        colour: shade(block.colour || paletteColour(0), rank, ordered.length),
        kind: 'compound',
        blockId: block.id,
        stepIndex: s.index,
      });
    });
  }
  for (const c of exp.bufferChannels) {
    paints.push({
      id: `buf:${c.id}`,
      label: c.name || 'buffer channel',
      short: (c.name || 'buffer').slice(0, 10),
      colour: c.colour || NEUTRAL,
      kind: 'channel',
    });
  }
  // Only while the step is on: switching it off must not leave stale paints behind.
  if (exp.inhibitors?.enabled) {
    for (const inh of exp.inhibitors.items) {
      paints.push({
        id: `inh:${inh.id}`,
        label: `${inh.name || 'inhibitor'} ${concentrationLabel(Math.log10(inh.conc_uM) - 6)}`,
        short: (inh.name || 'inhibitor').slice(0, 10),
        colour: inh.colour || NEUTRAL,
        kind: 'inhibitor',
      });
    }
    paints.push({
      id: INHIBITOR_VEHICLE_PAINT,
      label: 'Inhibitor vehicle',
      short: 'inh. vehicle',
      colour: exp.inhibitors.vehicleColour || NEUTRAL,
      kind: 'inhibitor',
    });
  }
  return paints;
}

export interface Well {
  id: string;
  row: number;
  col: number;
  rowLabel: string;
  transfectionId: string | null;
  treatments: string[];
  timePoint: string;
  notes: string;
}

export function resolveWells(layout: PlateLayout): Well[] {
  const g = PLATE_GEOMETRY[layout.format];
  const wells: Well[] = [];
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const id = wellId(g.rowLabels[row], col);
      const w = layout.wells[id] ?? {};
      wells.push({
        id,
        row,
        col,
        rowLabel: g.rowLabels[row],
        transfectionId: w.transfectionId !== undefined ? w.transfectionId : layout.rowTransfection[row] ?? null,
        treatments: w.treatments ?? [],
        timePoint: layout.rowTime[row] ?? '',
        notes: w.notes ?? '',
      });
    }
  }
  return wells;
}

export function isUsed(w: Well): boolean {
  return w.transfectionId !== null || w.treatments.length > 0;
}

/**
 * Paint one treatment onto a well: it replaces another step of the same compound, an
 * inhibitor replaces any other inhibitor (a well gets one, or the vehicle), and anything
 * else joins what is there.
 */
export function addTreatment(current: string[], paint: Paint): string[] {
  const withoutSameBlock = paint.blockId
    ? current.filter((id) => !id.startsWith(`cmp:${paint.blockId}:`))
    : paint.kind === 'inhibitor'
      ? current.filter((id) => !id.startsWith('inh:'))
      : current.filter((id) => id !== paint.id);
  return [...withoutSameBlock, paint.id];
}

export function removeTreatment(current: string[], id: string): string[] {
  return current.filter((t) => t !== id);
}

/** A compound's concentrations as typed in module 2: logM, separated by commas or spaces. */
export function formatLogMList(logM: (number | null)[]): string {
  return logM.filter((v): v is number => v !== null && Number.isFinite(v)).join(', ');
}

/**
 * Read a typed list of logM. Accepts the typographic minus; a comma always separates, never
 * a decimal point. Returns the bad token instead when one will not read.
 */
export function parseLogMList(text: string): { logM: number[] } | { error: string } {
  const tokens = text.replace(/−/g, '-').split(/[\s,;]+/).filter(Boolean);
  const logM: number[] = [];
  for (const t of tokens) {
    const v = Number(t);
    if (!Number.isFinite(v)) return { error: `“${t}” is not a logM` };
    logM.push(v);
  }
  return { logM };
}

/** An even dose-response: `count` steps down from `top`, `step` log units apart. */
export function logSeries(top: number, step: number, count: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => +(top - i * step).toFixed(6));
}

/** A block of wells, inclusive on both corners, in either order. */
export interface WellRect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function normaliseRect({ r0, c0, r1, c1 }: WellRect): WellRect {
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

export function inRect(rect: WellRect, row: number, col: number): boolean {
  const r = normaliseRect(rect);
  return row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
}

/**
 * Move a block of wells, as cut-and-paste in a spreadsheet. A well takes everything in it:
 * its treatments, notes and the cells it actually has — so a block moved onto a row seeded
 * with something else keeps its own cells. The wells it leaves go back to their row's cells.
 * It refuses rather than overwrite: there is no undo, and a painted well lost under a moved
 * block is easy to miss.
 */
export function moveBlock(
  layout: PlateLayout,
  rect: WellRect,
  dRow: number,
  dCol: number,
): { layout: PlateLayout } | { error: string } {
  const g = PLATE_GEOMETRY[layout.format];
  const r = normaliseRect(rect);
  if (dRow === 0 && dCol === 0) return { layout };
  if (r.r0 + dRow < 0 || r.r1 + dRow >= g.rows || r.c0 + dCol < 0 || r.c1 + dCol >= g.cols) {
    return { error: 'That would push the block off the plate.' };
  }
  const id = (row: number, col: number) => wellId(g.rowLabels[row], col);
  const hasContent = (w: WellState | undefined) =>
    Boolean(w && ((w.treatments?.length ?? 0) > 0 || w.transfectionId !== undefined || w.notes));

  const covered: string[] = [];
  for (let row = r.r0 + dRow; row <= r.r1 + dRow; row++) {
    for (let col = r.c0 + dCol; col <= r.c1 + dCol; col++) {
      if (!inRect(r, row, col) && hasContent(layout.wells[id(row, col)])) covered.push(id(row, col));
    }
  }
  if (covered.length > 0) {
    const list = covered.length > 6 ? `${covered.slice(0, 6).join(', ')}…` : covered.join(', ');
    return { error: `That would cover ${covered.length} painted well${covered.length === 1 ? '' : 's'} (${list}) — empty ${covered.length === 1 ? 'it' : 'them'} first.` };
  }

  const wells = { ...layout.wells };
  const moving: { row: number; col: number; state: WellState | undefined; cells: string | null }[] = [];
  for (let row = r.r0; row <= r.r1; row++) {
    for (let col = r.c0; col <= r.c1; col++) {
      const state = wells[id(row, col)];
      const cells = state?.transfectionId !== undefined ? state.transfectionId : layout.rowTransfection[row] ?? null;
      moving.push({ row, col, state, cells });
      delete wells[id(row, col)];
    }
  }
  for (const { row, col, state, cells } of moving) {
    const to = row + dRow;
    const next: WellState = {};
    if (state?.treatments?.length) next.treatments = state.treatments;
    if (state?.notes) next.notes = state.notes;
    if (cells !== (layout.rowTransfection[to] ?? null)) next.transfectionId = cells;
    if (Object.keys(next).length > 0) wells[id(to, col + dCol)] = next;
  }
  return { layout: { ...layout, wells } };
}

/**
 * A compound's concentrations were retyped: keep each painted well on the concentration it
 * had. A step is identified by its row, so inserting a step in the middle would otherwise
 * shift every well below it onto the next concentration. Steps are matched by value first;
 * a row whose value changed in place (a typo fixed) keeps its wells; a concentration that is
 * gone takes its wells' paint with it rather than leaving them on the wrong dose.
 */
export function remapCompoundSteps(
  layout: PlateLayout,
  blockId: string,
  before: (number | null)[],
  after: (number | null)[],
): PlateLayout {
  const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
  const map = new Map<number, number | null>();
  const taken = new Set<number>();
  before.forEach((v, i) => {
    const j = after.findIndex((w, k) => !taken.has(k) && same(v, w));
    if (j >= 0) { map.set(i, j); taken.add(j); }
  });
  before.forEach((v, i) => {
    if (map.has(i) || v === null) return;
    const inPlace = i < after.length && !taken.has(i) && after[i] !== null;
    map.set(i, inPlace ? i : null);
    if (inPlace) taken.add(i);
  });
  if ([...map].every(([i, j]) => i === j)) return layout;

  const prefix = `cmp:${blockId}:`;
  const wells: Record<string, WellState> = {};
  for (const [id, w] of Object.entries(layout.wells)) {
    if (!w.treatments?.some((t) => t.startsWith(prefix))) { wells[id] = w; continue; }
    const treatments = w.treatments.flatMap((t) => {
      if (!t.startsWith(prefix)) return [t];
      const j = map.get(Number(t.slice(prefix.length)));
      return j === undefined ? [t] : j === null ? [] : [`${prefix}${j}`];
    });
    wells[id] = { ...w, treatments };
  }
  return { ...layout, wells };
}

/**
 * How many wells each treatment covers. This is what module 3 needs: the volume of a
 * dilution step is the wells painted with it times what each well takes.
 */
export function wellsPerTreatment(layout: PlateLayout): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of resolveWells(layout)) {
    for (const t of w.treatments) counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

export function isEdgeWell(w: Well, format: PlateFormat): boolean {
  const g = PLATE_GEOMETRY[format];
  return w.row === 0 || w.col === 0 || w.row === g.rows - 1 || w.col === g.cols - 1;
}

export interface ReplicateGroup {
  key: string;
  transfectionId: string | null;
  treatments: string[];
  timePoint: string;
  wells: string[];
}

/** Wells that are the same experiment: same cells, same treatments, same time. */
export function replicateGroups(layout: PlateLayout): ReplicateGroup[] {
  const groups = new Map<string, ReplicateGroup>();
  for (const w of resolveWells(layout).filter(isUsed)) {
    const treatments = [...w.treatments].sort();
    const key = `${w.transfectionId}|${treatments.join('+')}|${w.timePoint}`;
    const g = groups.get(key);
    if (g) g.wells.push(w.id);
    else groups.set(key, { key, transfectionId: w.transfectionId, treatments, timePoint: w.timePoint, wells: [w.id] });
  }
  return [...groups.values()];
}

export interface LayoutSummary {
  used: number;
  total: number;
  /** Cells with nothing on them. */
  untreated: number;
  /** Treatment with no cells under it. */
  unseeded: number;
  edgeUsed: number;
  groups: ReplicateGroup[];
  wellsPerTreatment: Record<string, number>;
}

export function summarise(layout: PlateLayout): LayoutSummary {
  const wells = resolveWells(layout);
  const used = wells.filter(isUsed);
  return {
    used: used.length,
    total: wells.length,
    untreated: used.filter((w) => w.transfectionId !== null && w.treatments.length === 0).length,
    unseeded: used.filter((w) => w.transfectionId === null && w.treatments.length > 0).length,
    edgeUsed: used.filter((w) => isEdgeWell(w, layout.format)).length,
    groups: replicateGroups(layout),
    wellsPerTreatment: wellsPerTreatment(layout),
  };
}

export interface LongRow {
  well: string;
  row: string;
  col: number;
  transfection: string;
  treatments: string;
  replicate: number;
  time: string;
  notes: string;
}

export function toLongTable(layout: PlateLayout, transfections: Paint[], treatments: Paint[]): LongRow[] {
  const tName = new Map(transfections.map((p) => [p.id, p.label]));
  const trName = new Map(treatments.map((p) => [p.id, p.label]));
  const seen = new Map<string, number>();

  return resolveWells(layout)
    .filter(isUsed)
    .map((w) => {
      const sorted = [...w.treatments].sort();
      const key = `${w.transfectionId}|${sorted.join('+')}|${w.timePoint}`;
      const replicate = (seen.get(key) ?? 0) + 1;
      seen.set(key, replicate);
      return {
        well: w.id,
        row: w.rowLabel,
        col: w.col + 1,
        transfection: w.transfectionId ? tName.get(w.transfectionId) ?? '(deleted condition)' : '',
        treatments: w.treatments.map((t) => trName.get(t) ?? '(deleted treatment)').join(' + '),
        replicate,
        time: w.timePoint,
        notes: w.notes,
      };
    });
}
