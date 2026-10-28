/**
 * Module 2 exports: the plate as a colour-coded grid to carry to the bench, and the same
 * plate as a tidy long table — one row per well, which is what module 4 will map reader
 * output back onto. Colours are the ones on screen, so the two are read the same way.
 */

import * as XLSX from 'xlsx-js-style';
import type { LongRow, Paint } from '../calc/layout';
import { isUsed, resolveWells } from '../calc/layout';
import { inkOn, tint, toXlsx, WELL_TINT } from '../calc/palette';
import { PLATE_GEOMETRY } from '../calc/types';
import { slug, triggerDownload, type Project } from '../state/project';

type Cell = { v: string | number | null; s?: Record<string, unknown> };
type Row = (string | number | null | Cell)[];

/*
 * A well with two treatments is split diagonally on screen. Excel can draw that as a
 * gradient fill with a hard stop in the middle, but the style writer only knows pattern
 * fills — so such a well gets a placeholder fill whose colour is its index in `splits`,
 * and `withSplitFills` swaps each placeholder for the real gradient in the written file.
 */
const SPLIT_MARKER = 'gray0625';

function splitFill(splits: string[][], colours: string[]): Record<string, unknown> {
  splits.push(colours);
  return { patternType: SPLIT_MARKER, fgColor: { rgb: (splits.length - 1).toString(16).padStart(6, '0').toUpperCase() } };
}

/** The same 135° split as `diagonalSplit` on screen: first colour top left. */
function gradientXml(colours: string[]): string {
  const step = 1 / colours.length;
  const stops = colours.flatMap((c, i) => [
    `<stop position="${+(i * step).toFixed(4)}"><color rgb="FF${toXlsx(c)}"/></stop>`,
    `<stop position="${+((i + 1) * step).toFixed(4)}"><color rgb="FF${toXlsx(c)}"/></stop>`,
  ]);
  return `<fill><gradientFill degree="45">${stops.join('')}</gradientFill></fill>`;
}

export function withSplitFills(xlsx: Uint8Array, splits: string[][]): Uint8Array {
  if (splits.length === 0) return xlsx;
  const zip = XLSX.CFB.read(xlsx, { type: 'array' });
  const i = zip.FullPaths.findIndex((p: string) => p.endsWith('xl/styles.xml'));
  const entry = zip.FileIndex[i];
  const xml = new TextDecoder().decode(entry.content as Uint8Array).replace(
    new RegExp(`<fill><patternFill patternType="${SPLIT_MARKER}"><fgColor rgb="FF([0-9A-F]{6})"/>.*?</patternFill></fill>`, 'g'),
    (whole, index: string) => {
      const colours = splits[parseInt(index, 16)];
      return colours ? gradientXml(colours) : whole;
    },
  );
  entry.content = new TextEncoder().encode(xml) as any;
  entry.size = entry.content.length;
  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' }) as ArrayBuffer);
}

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

export function plateRows(project: Project, transfections: Paint[], treatments: Paint[], splits: string[][] = []): Row[] {
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
      const fills = paints.map((x) => tint(x.colour, WELL_TINT));
      // The transfection is the well's thick left edge, as on screen.
      const seed = w.transfectionId ? paint.get(w.transfectionId) : undefined;
      row.push({
        v: paints.map((x) => x.short).join('\n'),
        s: {
          font: { sz: 9, color: { rgb: toXlsx(fills[0] ? inkOn(fills[0]) : '#98a2b3') } },
          fill: fills.length > 1 ? splitFill(splits, fills) : fills.length === 1 ? { fgColor: { rgb: toXlsx(fills[0]) } } : undefined,
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: seed ? { ...border(), left: { style: 'thick', color: { rgb: toXlsx(seed.colour) } } } : border(),
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
    const background = tint(p.colour, WELL_TINT);
    const edge = p.kind === 'transfection' ? { ...border(), left: { style: 'thick', color: { rgb: toXlsx(p.colour) } } } : border();
    rows.push([
      { v: p.short, s: { font: { bold: true, sz: 10, color: { rgb: toXlsx(inkOn(background)) } }, fill: { fgColor: { rgb: toXlsx(background) } }, alignment: { horizontal: 'center' }, border: edge } },
      { v: p.label, s: { font: { sz: 11 } } },
      { v: p.kind === 'transfection' ? 'cells' : p.kind === 'channel' ? 'buffer channel' : p.kind === 'inhibitor' ? 'inhibitor' : 'compound', s: { font: { sz: 10, italic: true, color: { rgb: '667085' } } } },
    ]);
  }

  // Shared wells spelled out in full — the grid only has room for the short names.
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

function sheet(rows: Row[], widths: number[], heights: Record<number, number> = {}): XLSX.WorkSheet {
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
  ws['!rows'] = rows.map((_, r) => (heights[r] ? { hpt: heights[r] } : {}));
  return ws;
}

/** The plate workbook as bytes, split fills already in place. */
export function layoutWorkbook(project: Project, longTable: LongRow[], transfections: Paint[], treatments: Paint[]): Uint8Array {
  const g = PLATE_GEOMETRY[project.layout.format];
  const splits: string[][] = [];
  const plate = plateRows(project, transfections, treatments, splits);
  // Plate rows sit below the title block and the column header; tall enough for two labels.
  const heights = Object.fromEntries(Array.from({ length: g.rows }, (_, r) => [4 + r, 26]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet(plate, [6, ...Array.from({ length: g.cols }, () => 12), 28, 10], heights),
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

  return withSplitFills(new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })), splits);
}

export function exportLayoutXlsx(project: Project, longTable: LongRow[], transfections: Paint[], treatments: Paint[]): void {
  const out = layoutWorkbook(project, longTable, transfections, treatments);
  triggerDownload(new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), `${slug(project.name)}-plate.xlsx`);
}
