/**
 * Module 2 exports: the plate as a colour-coded grid to carry to the bench, and the same
 * plate as a tidy long table — one row per well, which is what module 4 will map reader
 * output back onto. Colours are the ones on screen, so the two are read the same way.
 */

import * as XLSX from 'xlsx-js-style';
import type { LongRow, Paint } from '../calc/layout';
import { isUsed, resolveWells } from '../calc/layout';
import { inkOn, tint, toXlsx } from '../calc/palette';
import { PLATE_GEOMETRY } from '../calc/types';
import { slug, triggerDownload, type Project } from '../state/project';

type Cell = { v: string | number | null; s?: Record<string, unknown> };
type Row = (string | number | null | Cell)[];

const border = (colour = 'D8DBE0') => ({
  top: { style: 'thin', color: { rgb: colour } },
  bottom: { style: 'thin', color: { rgb: colour } },
  left: { style: 'thin', color: { rgb: colour } },
  right: { style: 'thin', color: { rgb: colour } },
});

const head = (v: string): Cell => ({
  v,
  s: { font: { bold: true, sz: 12 }, alignment: { horizontal: 'center' }, border: border() },
});

export function plateRows(project: Project, transfections: Paint[], treatments: Paint[]): Row[] {
  const layout = project.layout;
  const g = PLATE_GEOMETRY[layout.format];
  const wells = resolveWells(layout);
  const paint = new Map([...transfections, ...treatments].map((p) => [p.id, p]));

  const rows: Row[] = [
    [{ v: `PLATE — ${layout.format}`, s: { font: { bold: true, sz: 16 } } }],
    [{ v: project.name, s: { font: { italic: true, sz: 11, color: { rgb: '667085' } } } }],
    [],
    [head(''), ...Array.from({ length: g.cols }, (_, c) => head(String(c + 1))), head('Cells in this row'), head('Time')],
  ];

  for (let r = 0; r < g.rows; r++) {
    const row: Row = [head(g.rowLabels[r])];
    for (let c = 0; c < g.cols; c++) {
      const w = wells.find((x) => x.row === r && x.col === c)!;
      const paints = w.treatments.map((t) => paint.get(t)).filter((x): x is Paint => Boolean(x));
      const p = paints[0];
      // Excel cannot split a cell diagonally, so a shared well is filled from the first
      // treatment and names them both — the widths below leave room for it.
      const background = p ? tint(p.colour, 0.3) : undefined;
      row.push({
        v: paints.map((x) => x.short).join(' + '),
        s: {
          font: { sz: 9, color: { rgb: toXlsx(background ? inkOn(background) : '#98a2b3') } },
          fill: background ? { fgColor: { rgb: toXlsx(background) } } : undefined,
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: border(),
        },
      });
    }
    const seed = layout.rowTransfection[r];
    const seedPaint = seed ? paint.get(seed) : undefined;
    row.push({
      v: seedPaint?.label ?? (seed ? '(deleted)' : ''),
      s: {
        font: { bold: Boolean(seed), sz: 11, color: { rgb: seedPaint ? toXlsx(seedPaint.colour) : '16181D' } },
        border: border(),
      },
    });
    row.push({ v: layout.rowTime[r] ?? '', s: { font: { sz: 10, color: { rgb: '667085' } }, border: border() } });
    rows.push(row);
  }

  rows.push([], [{ v: 'LEGEND', s: { font: { bold: true, sz: 12 } } }]);
  for (const p of [...transfections, ...treatments]) {
    const background = tint(p.colour, 0.3);
    rows.push([
      { v: p.short, s: { font: { bold: true, sz: 10, color: { rgb: toXlsx(inkOn(background)) } }, fill: { fgColor: { rgb: toXlsx(background) } }, alignment: { horizontal: 'center' }, border: border() } },
      { v: p.label, s: { font: { sz: 11 } } },
      { v: p.kind === 'transfection' ? 'cells' : p.kind === 'channel' ? 'buffer channel' : p.kind === 'inhibitor' ? 'inhibitor' : 'compound', s: { font: { sz: 10, italic: true, color: { rgb: '667085' } } } },
    ]);
  }

  // Wells in a single well, spelled out — the grid can only show the last paint.
  const layered = wells.filter((w) => isUsed(w) && w.treatments.length > 1);
  if (layered.length > 0) {
    rows.push([], [{ v: 'WELLS WITH MORE THAN ONE TREATMENT', s: { font: { bold: true, sz: 12 } } }]);
    for (const w of layered) {
      rows.push([
        { v: w.id, s: { font: { bold: true, sz: 11 } } },
        { v: w.treatments.map((t) => paint.get(t)?.label ?? '(deleted)').join(' + '), s: { font: { sz: 11 } } },
      ]);
    }
  }
  return rows;
}

function sheet(rows: Row[], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c))));
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell && typeof cell === 'object' && cell.s) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].s = cell.s;
      }
    }),
  );
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

export function exportLayoutXlsx(project: Project, longTable: LongRow[], transfections: Paint[], treatments: Paint[]): void {
  const g = PLATE_GEOMETRY[project.layout.format];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet(plateRows(project, transfections, treatments), [6, ...Array.from({ length: g.cols }, () => 14), 28, 10]),
    'Plate',
  );

  const tidy: Row[] = [
    ['well', 'row', 'col', 'transfection', 'treatments', 'replicate', 'time', 'notes'].map((h) => ({
      v: h,
      s: { font: { bold: true, sz: 12 } },
    })),
    ...longTable.map((r): Row => [r.well, r.row, r.col, r.transfection, r.treatments, r.replicate, r.time, r.notes]),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(tidy, [8, 6, 6, 26, 34, 10, 10, 20]), 'Wells');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${slug(project.name)}-plate.xlsx`);
}
