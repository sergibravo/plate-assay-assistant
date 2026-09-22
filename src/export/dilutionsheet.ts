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
    ...result.bufferChannels.map((c) =>
      param(
        `Buffer channel — ${c.name || 'unnamed'}`,
        `${round(c.required_ul, 1)} µl`,
        c.matched ? 'made of the DMSO diluent' : 'made of the plain diluent',
      ),
    ),
    param(
      'The well',
      `${exp.addition.assayBuffer_ul} µl buffer + ${result.substrate.enabled ? `${exp.substrate.volumePerWell_ul} µl substrate + ` : ''}${exp.addition.compound_ul} µl compound`,
      `compound diluted ${round(result.additionFactor, 3)}×`,
    ),
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
      { v: 'Prepare, in this order', s: { font: { bold: true } } },
      { v: 'Prepare (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: 'Start from (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: 'DMSO (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: exp.bsa.enabled ? `BSA ${exp.bsa.stockPct} % (µl)` : 'BSA (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: 'Other ingredients (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
    ],
    ...result.recipes.filter((r) => !r.isPlainDraw && !r.isPlainBuffer && r.required_ul > 0).map((r): Row => [
      { v: `${r.name}${r.overridden ? ' (volume you set)' : ''} — from ${r.baseName}`, s: pipetteLabel() },
      { v: r.prepare_ul, s: pipette() },
      { v: round(r.base_ul, 2), s: pipette() },
      { v: r.dmso_ul > 0 ? round(r.dmso_ul, 3) : '—', s: pipette() },
      { v: r.bsaStock_ul > 0 ? round(r.bsaStock_ul, 3) : '—', s: pipette() },
      { v: r.components.length > 0 ? r.components.map((c) => `${c.name}: ${round(c.volume_ul, 3)}`).join(' · ') : '—', s: pipette() },
    ]),
    [{ v: result.target > 0 ? `The DMSO diluent is ${result.assay.diluent} premixed at ${pct(result.target)} DMSO; the other carries none.` : 'No DMSO stocks: plain diluent throughout.', s: muted() }],
    [{ v: 'Make the batch first, then take from it for each of the others.', s: muted() }],
    ...(result.plainBuffer_ul > 0
      ? ([[
          { v: `Plus ${round(result.plainBuffer_ul, 0)} µl of plain ${result.assay.diluent} from the bottle`, s: label() },
          { v: '', s: label() },
          { v: 'nothing to prepare', s: muted() },
        ]] as Row[])
      : []),
    ...(result.recipes.some((r) => r.isPlainDraw && !r.isPlainBuffer && r.required_ul > 0)
      ? ([
          [{ v: 'Then pour off, no additions:', s: { font: { bold: true } } }],
          ...result.recipes
            .filter((r) => r.isPlainDraw && !r.isPlainBuffer && r.required_ul > 0)
            .map((r): Row => [
              { v: r.name, s: label() },
              { v: round(r.required_ul, 1), s: value() },
              { v: round(r.base_ul, 1), s: pipette() },
            ]),
          [{ v: 'Same buffer, just portioned out — already counted in the batch above.', s: muted() }],
        ] as Row[])
      : []),
    ...result.recipes
      .filter((r) => r.leftShortFor.length > 0 || r.correctedFor.length > 0)
      .map((r): Row => [
        {
          v: r.correctedFor.length > 0
            ? `${r.name}: topped up with extra ${r.correctedFor.join(' and ')} to stay on target after the stocks displaced some buffer.`
            : `${r.name}: the stocks leave ${r.leftShortFor.map((x) => `${x.name} at ${round(x.achieved * 100, 5)} % (target ${round(x.target * 100, 5)} %)`).join(', ')} — inside pipetting error, left as is.`,
          s: muted(),
        },
      ]),
  ];

  for (const note of result.assay.pending) rows.push([{ v: `Note: ${note}`, s: muted() }]);
  if (exp.bufferNotes.trim()) {
    rows.push([], section('BUFFER RECIPES'), [{ v: exp.bufferNotes, s: label() }]);
  }

  if (result.fluorescein.enabled || result.tb.enabled) {
    rows.push([], section('DERET — BEFORE THE ASSAY'));
    if (result.tb.enabled) {
      const tb = exp.tb;
      rows.push(...[
        param('Tb solution', `${round(result.tb.required_ul, 1)} µl`, `${tb.volumePerWell_ul} µl × ${tb.wells} wells + ${round(tb.extraVolume_ul, 1)} µl extra`),
        [{ v: '  Tb stock', s: pipetteLabel() }, { v: round(result.tb.stock_ul, 3), s: pipette() }, { v: `µl  (1:${round(tb.dilution, 1)})`, s: unit() }],
        [{ v: '  Diluent', s: pipetteLabel() }, { v: round(result.tb.diluent_ul, 1), s: pipette() }, { v: 'µl', s: unit() }],
        [{ v: tb.notes || 'Added before everything else and washed out once the cells are labelled.', s: muted() }],
      ]);
    }
    if (result.fluorescein.enabled && result.fluorescein.intoBuffer && result.fluorescein.intermediate) {
      const f = exp.fluorescein;
      rows.push([], [{ v: 'Fluorescein — every buffer carries it at 1×', s: { font: { bold: true } } }]);
      rows.push([
        { v: 'Step', s: { font: { bold: true } } },
        { v: 'Make (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
        { v: 'Take (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
        { v: 'Into (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      ]);
      for (const st of [result.fluorescein.intermediate, result.fluorescein.intoBuffer]) {
        rows.push([
          { v: `${round(st.from_uM, 1)} µM → ${round(st.product_uM, 1)} µM  (1:${round(st.fold, 1)})`, s: label() },
          { v: round(st.prepare_ul, 1), s: pipette() },
          { v: round(st.stock_ul, 3), s: pipette() },
          { v: round(st.diluent_ul, 1), s: pipette() },
        ]);
      }
      rows.push([{ v: `The batch below is that ${round(f.target_uM, 1)} µM fluorescein buffer; every compound diluent is drawn from it.`, s: muted() }]);
      rows.push(
        param(`  on the cells — ${round(result.wellsBuffered, 1)} wells × ${round(exp.addition.assayBuffer_ul, 1)} µl`, round(result.bufferUse.wells_ul, 1), 'µl'),
        param(
          result.bufferUse.channels_ul > 0
            ? `  for the compounds (buffer channels included: ${round(result.bufferUse.channels_ul, 1)} µl)`
            : '  for the compounds',
          round(result.bufferUse.compounds_ul, 1),
          'µl',
        ),
      );
    }
  }

  if (result.substrate.enabled) {
    const sub = exp.substrate;
    rows.push([], section('SUBSTRATE'));
    rows.push(...[
      param('Added per well', `${sub.volumePerWell_ul} µl`, `into ${round(result.substrate.assayBufferPerWell_ul, 1)} µl of ${result.assay.diluent}`),
      param('Wells + extra', `${sub.wells} wells + ${round(sub.extraVolume_ul, 1)} µl`, `= ${round(result.substrate.required_ul, 1)} µl to prepare`),
      param(
        'Diluted in the well by',
        `${round(result.substrate.foldFactor, 3)}×`,
        sub.reference === 'after-compounds' ? 'counting the compound addition' : 'before the compounds go in',
      ),
    ]);
    rows.push([
      { v: 'Component', s: { font: { bold: true } } },
      { v: '1:N in the solution', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: '1:N in the well', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: 'Stock to add (µl)', s: { font: { bold: true }, alignment: { horizontal: 'right' } } },
      { v: 'Notes', s: { font: { bold: true } } },
    ]);
    for (const c of result.substrate.components) {
      rows.push([
        { v: c.name, s: label() },
        { v: round(c.preparedDilution, 2), s: value() },
        { v: round(c.inWellDilution, 2), s: value() },
        { v: round(c.stock_ul, 3), s: pipette() },
        { v: c.notes, s: muted() },
      ]);
    }
    rows.push([{ v: `Make the substrate solution up in the same ${result.assay.diluent} as the well — see the premix table above.`, s: muted() }]);
    if (sub.notes.trim()) rows.push([{ v: sub.notes, s: muted() }]);
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
      rows.push([{ v: `${source.volForWells_ul} µl per step + ${round(source.extraVolume_ul, 1)} µl extra · ${round(source.dilutionFactorOverride ?? result.additionFactor, 3)}× dilution on addition · take ${round(b.stockNeeded_ul, 3)} µl of stock`, s: muted() }]);
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
    [{ v: `1. Premix the diluents above — all of them in ${result.assay.diluent}.`, s: label() }],
    ...(result.substrate.enabled ? [[{ v: '1b. Prepare the substrate solution in that same buffer.', s: label() }] as Row] : []),
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
  XLSX.utils.book_append_sheet(wb, sheetFromRows(dilutionBenchSheetRows(project, result), [34, 18, 20, 20, 20, 30, 16]), 'Dilutions');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${slug(project.name)}-dilutions.xlsx`);
}
