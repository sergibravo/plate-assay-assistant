/**
 * Bench-sheet export. Values only — no formulas — so what the scientist carries to
 * the hood is exactly what the app computed and showed on screen.
 *
 * Uses `xlsx-js-style` (a SheetJS build with cell styling) so the printed sheet is
 * readable at a glance: one coloured table per condition, bold totals, boxed
 * master-mix volumes.
 */

import * as XLSX from 'xlsx-js-style';
import type { DnaMixResult, MasterMixTotals, PerConditionTotals } from '../calc/transfection';
import type { TransfectionParams } from '../calc/types';
import { round, roundUl } from '../calc/units';
import { slug, triggerDownload, type Project } from '../state/project';

type CellValue = string | number | null;
type Style = Record<string, unknown>;
interface Cell {
  v: CellValue;
  s?: Style;
}
type Row = (CellValue | Cell)[];

const INK = '1A1A1A';
const MUTED = '667085';

/**
 * Everything on the bench sheet sits one point above Excel's 11 pt default — it is read
 * at arm's length in a hood, often through a visor. `bumpFontSizes` applies the +1 in one
 * place at the end, so no style helper can forget it.
 */
const BASE_FONT_PT = 11;

/** One colour family per condition block, cycled. */
const BLOCK_COLOURS = [
  { head: '2563EB', tint: 'E5EDFB' },
  { head: '047857', tint: 'DDF3EA' },
  { head: 'B45309', tint: 'FBEEDC' },
  { head: '7C3AED', tint: 'EDE6FC' },
  { head: 'BE185D', tint: 'FBE3EE' },
  { head: '0E7490', tint: 'DDF0F4' },
];

const border = (colour = 'D8DBE0') => ({
  top: { style: 'thin', color: { rgb: colour } },
  bottom: { style: 'thin', color: { rgb: colour } },
  left: { style: 'thin', color: { rgb: colour } },
  right: { style: 'thin', color: { rgb: colour } },
});

const title = (): Style => ({ font: { bold: true, sz: 15, color: { rgb: INK } } });
const sectionHead = (): Style => ({
  font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '344054' } },
  alignment: { vertical: 'center' },
});
const label = (): Style => ({ font: { color: { rgb: INK } } });
const muted = (): Style => ({ font: { italic: true, sz: 10, color: { rgb: MUTED } } });
const value = (): Style => ({ alignment: { horizontal: 'right' }, border: border() });
const unit = (): Style => ({ font: { sz: 10, color: { rgb: MUTED } } });
const pipette = (): Style => ({
  font: { bold: true, sz: 12 },
  fill: { fgColor: { rgb: 'F2F7FF' } },
  alignment: { horizontal: 'right' },
  border: border('93B4E0'),
});
const pipetteLabel = (): Style => ({ font: { bold: true }, fill: { fgColor: { rgb: 'F2F7FF' } } });

const param = (name: string, v: CellValue, u = ''): Row => [
  { v: name, s: label() },
  { v, s: value() },
  { v: u, s: unit() },
];

export function transfectionBenchSheetRows(
  project: Project,
  per: PerConditionTotals,
  mix: MasterMixTotals,
  conditions: DnaMixResult[],
): { setup: Row[]; dnaMixes: Row[] } {
  const p: TransfectionParams = project.transfection;
  const section = (text: string): Row => [
    { v: text, s: sectionHead() },
    { v: '', s: sectionHead() },
    { v: '', s: sectionHead() },
  ];

  const setup: Row[] = [
    [{ v: 'REVERSE-TRANSFECTION BENCH SHEET', s: title() }],
    [{ v: 'Experiment', s: label() }, { v: project.name, s: { font: { bold: true } } }],
    [{ v: 'Printed', s: label() }, { v: new Date().toLocaleString(), s: muted() }],
    [],
    section('PARAMETERS'),
    param('Wells per condition', p.wellsPerCondition, 'wells'),
    param('DNA per well', p.dna_ng_per_well, 'ng'),
    param('OptiMEM per well', p.optimem_ul_per_well, 'µl'),
    param('OptiMEM mode', p.optimemMode === 'fixed' ? 'fixed volume added' : 'target final volume', ''),
    param('PEI:DNA ratio', p.peiDnaRatio, 'w/w'),
    param('Extra transfection mix', p.transfectionMixExtra_ul, 'µl'),
    param('Extra cell suspension', p.cellSuspensionExtra_ul, 'µl'),
    param('Cells per well', p.cells_k_per_well, 'k cells'),
    param('DMEM per well', p.dmem_ul_per_well, 'µl'),
    param('PEI stock', p.pei_ug_per_ul, 'µg/µl'),
    param('Plate format', p.plateFormat, ''),
    param('OptiMEM lot #', p.optimemLot, ''),
    param('PEI lot #', p.peiLot, ''),
    [],
    section('PER CONDITION'),
    param('Total DNA', round(per.totalDna_ng, 3), 'ng'),
    param('PEI', roundUl(per.pei_ul), 'µl'),
    param('OptiMEM for DNA', roundUl(per.optimemForDna_ul), 'µl'),
    param('OptiMEM for PEI', roundUl(per.optimemForPei_ul), 'µl'),
    param('DMEM', roundUl(per.dmem_ul), 'µl'),
    param('Cells', round(per.cells_k, 2), 'k cells'),
    [],
    section(`PEI MASTER MIX — ${mix.nConditions} conditions + ${round(p.transfectionMixExtra_ul, 1)} µl extra`),
    [{ v: 'Pipette these two into one tube:', s: muted() }],
    [{ v: 'Total PEI', s: pipetteLabel() }, { v: roundUl(mix.totalPei_ul), s: pipette() }, { v: 'µl', s: unit() }],
    [{ v: 'Total OptiMEM for PEI', s: pipetteLabel() }, { v: roundUl(mix.totalOptimemForPei_ul), s: pipette() }, { v: 'µl', s: unit() }],
    param('→ combined volume', roundUl(mix.totalPei_ul + mix.totalOptimemForPei_ul), 'µl'),
    [],
    section(`CELL SUSPENSION — ${mix.nConditions} conditions + ${round(p.cellSuspensionExtra_ul, 1)} µl extra`),
    [{ v: 'DMEM total', s: pipetteLabel() }, { v: roundUl(mix.dmemTotal_ul), s: pipette() }, { v: 'µl', s: unit() }],
    [{ v: 'Total cells needed', s: pipetteLabel() }, { v: round(mix.totalCells_k, 1), s: pipette() }, { v: 'k cells', s: unit() }],
    param('  (= millions)', round(mix.totalCells_k / 1000, 4), 'M'),
    param('Suspension per condition', roundUl(mix.cellSuspensionPerCondition_ul), 'µl'),
    [],
    section('DNA STOCKS USED'),
    [
      { v: 'ID', s: { font: { bold: true } } },
      { v: 'DNA', s: { font: { bold: true } } },
      { v: 'Stock conc. (ng/µl)', s: { font: { bold: true } } },
      { v: 'Notes', s: { font: { bold: true } } },
    ],
  ];
  for (const s of project.dnaStocks) {
    setup.push([
      { v: s.plasmidId, s: label() },
      { v: s.name, s: label() },
      { v: s.stockConc_ng_per_ul ?? '—', s: value() },
      { v: s.isFiller ? `${s.notes} (filler)`.trim() : s.notes, s: muted() },
    ]);
  }

  setup.push([], section('PROTOCOL'));
  for (const step of [
    '1. Prepare DNA + OptiMEM mixes per condition (see DNA Mixes sheet).',
    '2. Prepare the PEI + OptiMEM master mix (values above).',
    '3. Add an equal volume of PEI/OptiMEM to each DNA/OptiMEM tube.',
    '4. Incubate 15–20 min at RT.',
    '5. Add the transfection complex to the wells.',
    '6. Add the cell suspension to the wells.',
    '7. Incubate at 37 °C, 5 % CO₂.',
  ]) {
    setup.push([{ v: step, s: label() }]);
  }
  if (project.notes.trim()) setup.push([], section('NOTES'), [{ v: project.notes, s: label() }]);

  const stockById = new Map(project.dnaStocks.map((s) => [s.id, s]));
  const dnaMixes: Row[] = [
    [{ v: 'DNA MIXES — one tube per condition', s: title() }],
    [{ v: project.name, s: muted() }],
    [],
  ];

  conditions
    .filter((c) => !c.isEmpty)
    .forEach((c, i) => {
      const colour = BLOCK_COLOURS[i % BLOCK_COLOURS.length];
      const head = (v: CellValue): Cell => ({
        v,
        s: {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: colour.head } },
          alignment: { horizontal: 'right' },
          border: border(colour.head),
        },
      });
      const body = (v: CellValue, right = true): Cell => ({
        v,
        s: {
          alignment: { horizontal: right ? 'right' : 'left' },
          fill: { fgColor: { rgb: colour.tint } },
          border: border('FFFFFF'),
        },
      });
      const totalCell = (v: CellValue, right = true): Cell => ({
        v,
        s: {
          font: { bold: true },
          alignment: { horizontal: right ? 'right' : 'left' },
          fill: { fgColor: { rgb: colour.tint } },
          border: { top: { style: 'medium', color: { rgb: colour.head } } },
        },
      });

      dnaMixes.push([
        {
          v: `${c.code}${c.label ? ` — ${c.label}` : ''}`,
          s: { font: { bold: true, sz: 12, color: { rgb: colour.head } } },
        },
      ]);
      dnaMixes.push([head('ID'), { ...head('DNA'), s: { ...(head('DNA').s as Style), alignment: { horizontal: 'left' } } }, head('%'), head('ng'), head('µl')]);
      for (const r of c.rows.filter((r) => r.pct > 0 || r.isFiller)) {
        dnaMixes.push([
          body(stockById.get(r.dnaStockId)?.plasmidId ?? '', false),
          body(r.isFiller ? `${r.name} (filler)` : r.name, false),
          body(round(r.pct, 4)),
          body(round(r.ng, 3)),
          body(r.ul === null ? '—' : roundUl(r.ul)),
        ]);
      }
      dnaMixes.push([
        totalCell('', false),
        totalCell('TOTAL DNA', false),
        totalCell(round(c.totalPct, 4)),
        totalCell(round(c.totalNg, 3)),
        totalCell(roundUl(c.totalUl)),
      ]);
      dnaMixes.push([
        { v: '', s: label() },
        { v: '+ OptiMEM', s: pipetteLabel() },
        { v: '', s: label() },
        { v: '', s: label() },
        { v: roundUl(c.optimemForDna_ul), s: pipette() },
      ]);
      dnaMixes.push([
        { v: '', s: label() },
        { v: '= tube total', s: muted() },
        { v: '', s: label() },
        { v: '', s: label() },
        { v: roundUl(c.tubeTotal_ul), s: { alignment: { horizontal: 'right' }, font: { color: { rgb: MUTED } } } },
      ]);
      dnaMixes.push([
        {
          v: c.pctOk ? '✓ composition OK' : '⚠ composition ≠ 100 %',
          s: { font: { bold: true, color: { rgb: c.pctOk ? '067647' : 'B42318' } } },
        },
      ]);
      dnaMixes.push([]);
    });

  return { setup: bumpFontSizes(setup), dnaMixes: bumpFontSizes(dnaMixes) };
}

/** Add 1 pt to every cell, whether it carries an explicit size or Excel's default. */
function bumpFontSizes(rows: Row[]): Row[] {
  return rows.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return cell;
      if (typeof cell !== 'object') return { v: cell, s: { font: { sz: BASE_FONT_PT + 1 } } };
      const style = { ...(cell.s ?? {}) } as Style & { font?: { sz?: number } };
      const font = { ...(style.font ?? {}) };
      font.sz = (font.sz ?? BASE_FONT_PT) + 1;
      style.font = font;
      return { ...cell, s: style };
    }),
  );
}

function sheetFromRows(rows: Row[], colWidths: number[]): XLSX.WorkSheet {
  const aoa = rows.map((r) => r.map((c) => (c !== null && typeof c === 'object' ? c.v : c)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell !== null && typeof cell === 'object' && cell.s) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].s = cell.s;
      }
    });
  });
  ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  return ws;
}

export function exportTransfectionXlsx(
  project: Project,
  per: PerConditionTotals,
  mix: MasterMixTotals,
  conditions: DnaMixResult[],
): void {
  const { setup, dnaMixes } = transfectionBenchSheetRows(project, per, mix, conditions);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(setup, [35, 18, 18, 33]), 'Bench sheet');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(dnaMixes, [13, 29, 11, 13, 11]), 'DNA Mixes');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${slug(project.name)}-transfection.xlsx`);
}
