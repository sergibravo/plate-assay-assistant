/**
 * Module 3 bench sheet: one colour-coded table per compound, in the order they are
 * pipetted (most concentrated tube first), plus the diluents to premix.
 */

import * as XLSX from 'xlsx-js-style';
import type { DilutionResult } from '../calc/dilutions';
import { round } from '../calc/units';
import { slug, triggerDownload, type Project } from '../state/project';

type CellValue = string | number | null;
type Style = Record<string, unknown>;
interface Cell {
  v: CellValue;
  s?: Style;
}
type Row = (CellValue | Cell)[];

const MUTED = '667085';
const BASE_FONT_PT = 11;

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

const title = (): Style => ({ font: { bold: true, sz: 15 } });
const sectionHead = (): Style => ({
  font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '344054' } },
});
const label = (): Style => ({});
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

export function dilutionBenchSheetRows(project: Project, result: DilutionResult): Row[] {
  const exp = project.dilutions;
  const section = (text: string): Row => [
    { v: text, s: sectionHead() },
    { v: '', s: sectionHead() },
    { v: '', s: sectionHead() },
  ];
  const pct = (x: number) => `${round(x * 100, 4)} %`;

  const rows: Row[] = [
    [{ v: 'SERIAL DILUTION BENCH SHEET', s: title() }],
    [{ v: 'Experiment', s: label() }, { v: project.name, s: { font: { bold: true } } }],
    [{ v: 'Assay', s: label() }, { v: exp.assayType, s: { font: { bold: true } } }],
    [{ v: 'Printed', s: label() }, { v: new Date().toLocaleString(), s: muted() }],
    [],
    section('DMSO VEHICLE MATCHING  (concentrations, not volumes)'),
    param('DMSO in every tube', pct(result.target)),
    param('DMSO in the well', pct(result.inWellDmso), exp.dmsoPlacement === 'all-buffers' ? 'every buffer carries it' : `after the ${round(result.additionFactor, 3)}× addition`),
    param('Set by', exp.dmsoOverride !== null ? 'a forced value' : result.computedTarget > 0 ? 'the worst DMSO stock' : 'no DMSO stocks in use'),
    param('Added to the well', `${exp.addition.compound_ul} µl into ${exp.addition.inWell_ul} µl`, `= ${round(result.additionFactor, 3)}×`),
    ...(exp.bsa.enabled
      ? [
          [],
          section('BSA CARRIER'),
          param('BSA in every tube', pct(result.bsaBufferFraction)),
          param('BSA in the well', pct(result.bsaInWell), exp.bsa.placement === 'all-buffers' ? 'every buffer carries it' : `after the ${round(result.additionFactor, 3)}× addition`),
          param('Made from a stock at', `${exp.bsa.stockPct} %`),
        ]
      : []),
    [],
    section(`PREMIX THE DILUENTS — ${result.assay.diluent.toUpperCase()}`),
    [
      { v: 'Diluent', s: { font: { bold: true } } },
      { v: 'Prepare (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: `${result.assay.diluent} (µl)`, s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: 'DMSO (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: exp.bsa.enabled ? `BSA ${exp.bsa.stockPct} % (µl)` : 'BSA (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
    ],
    ...result.recipes.map((r): Row => [
      { v: `${r.name}${r.overridden ? ' (volume you set)' : ''}`, s: pipetteLabel() },
      { v: r.prepare_ul, s: pipette() },
      { v: round(r.base_ul, 2), s: pipette() },
      { v: r.dmso_ul > 0 ? round(r.dmso_ul, 3) : '—', s: pipette() },
      { v: r.bsaStock_ul > 0 ? round(r.bsaStock_ul, 3) : '—', s: pipette() },
    ]),
    [{ v: result.target > 0 ? `The DMSO diluent is ${result.assay.diluent} premixed at ${pct(result.target)} DMSO; the other carries none.` : 'No DMSO stocks: plain diluent throughout.', s: muted() }],
    [{ v: `Volumes are rounded up from what the compounds consume (${result.recipes.map((r) => `${r.name}: ${round(r.required_ul, 1)} µl`).join(' · ')}).`, s: muted() }],
  ];

  for (const note of result.assay.pending) rows.push([{ v: `Note: ${note}`, s: muted() }]);
  if (exp.bufferNotes.trim()) {
    rows.push([], section('BUFFER RECIPES'), [{ v: exp.bufferNotes, s: label() }]);
  }

  rows.push([]);

  result.blocks
    .filter((b) => !b.isEmpty)
    .forEach((b, i) => {
      const colour = BLOCK_COLOURS[i % BLOCK_COLOURS.length];
      const source = exp.blocks.find((x) => x.id === b.blockId)!;
      const head = (v: CellValue): Cell => ({
        v,
        s: {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: colour.head } },
          alignment: { horizontal: 'right', wrapText: true },
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

      rows.push([{ v: `${b.name || 'compound'} — ${source.stockConc_uM} µM stock in ${source.vehicle}${source.excludeFromVehicleMatch ? ', not DMSO-matched' : ''}`, s: { font: { bold: true, sz: 12, color: { rgb: colour.head } } } }]);
      rows.push([{ v: `${source.volForWells_ul} µl per step × ${source.margin} margin · ${round(source.dilutionFactorOverride ?? result.additionFactor, 3)}× dilution on addition · take ${round(b.stockNeeded_ul, 3)} µl of stock`, s: muted() }]);
      rows.push([
        head('Conc. (logM)'),
        head('In tube (µM)'),
        head('Vol to prepare (µl)'),
        head('From prev. or stock (µl)'),
        head(`${result.assay.normalBufferName} (µl)`),
        head(`${result.assay.dmsoBufferName} (µl)`),
        head('Left for wells (µl)'),
      ]);
      for (const r of b.rows) {
        rows.push([
          body(r.logM),
          body(round(r.tubeConc_uM, 4)),
          body(r.volToPrepare_ul),
          body(`${round(r.aliquotIn_ul, 3)}${r.aliquotFrom === 'stock' ? ' (stock)' : ''}`),
          body(round(r.normalBuffer_ul, 2)),
          body(round(r.dmsoBuffer_ul, 2)),
          body(round(r.leftForWells_ul, 2)),
        ]);
      }
      rows.push([
        { v: 'TOTAL', s: { font: { bold: true } } },
        { v: '', s: label() },
        { v: '', s: label() },
        { v: round(b.stockNeeded_ul, 3), s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
        { v: round(b.totalNormalBuffer_ul, 2), s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
        { v: round(b.totalDmsoBuffer_ul, 2), s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
        { v: '', s: label() },
      ]);
      if (source.notes.trim()) rows.push([{ v: source.notes, s: muted() }]);
      rows.push([]);
    });

  rows.push(
    section('ORDER OF WORK'),
    [{ v: `1. Premix the two diluents above (${result.assay.diluent}).`, s: label() }],
    [{ v: '2. For each compound, start at the top tube: add its stock aliquot, then the buffers.', s: label() }],
    [{ v: '3. Work downwards, each tube drawing its aliquot from the tube above it.', s: label() }],
    [{ v: '4. "Left for wells" is what remains once the tube below has taken its aliquot.', s: label() }],
  );

  return bumpFontSizes(rows);
}

function sheetFromRows(rows: Row[], colWidths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c !== null && typeof c === 'object' ? c.v : c))));
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell !== null && typeof cell === 'object' && cell.s) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].s = cell.s;
      }
    }),
  );
  ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  return ws;
}

export function exportDilutionsXlsx(project: Project, result: DilutionResult): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(dilutionBenchSheetRows(project, result), [30, 16, 20, 20, 20, 20, 16]), 'Dilutions');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${slug(project.name)}-dilutions.xlsx`);
}
