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

import type { DilutionExperiment } from './dilutions';
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
  kind: 'transfection' | 'compound' | 'channel';
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

/** Paint one treatment onto a well: it replaces another step of the same compound, and joins anything else. */
export function addTreatment(current: string[], paint: Paint): string[] {
  const withoutSameBlock = paint.blockId
    ? current.filter((id) => !id.startsWith(`cmp:${paint.blockId}:`))
    : current.filter((id) => id !== paint.id);
  return [...withoutSameBlock, paint.id];
}

export function removeTreatment(current: string[], id: string): string[] {
  return current.filter((t) => t !== id);
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
