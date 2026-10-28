import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { emptyLayout, toLongTable, transfectionPaints, treatmentPaints } from '../layout';
import { tint, toXlsx, WELL_TINT } from '../palette';
import { layoutWorkbook } from '../../export/layoutsheet';
import { defaultInhibitorStep, enableCondition, newInhibitor, newProject } from '../../state/project';

/** A 384-well DMR-style plate: a dose series, half of it on top of an inhibitor. */
function demoProject() {
  const p = newProject('Split wells');
  const cond = enableCondition(p.grid.conditions[0][0], p.dnaStocks);
  p.grid = { ...p.grid, conditions: p.grid.conditions.map((row, rg) => row.map((c, col) => (rg === 0 && col === 0 ? cond : c))) };
  p.dilutions.blocks[0].logM = [-9, -8, -7, -6, null, null, null, null];
  p.dilutions.inhibitors = { ...defaultInhibitorStep(), enabled: true, items: [{ ...newInhibitor('YM', 0) }] };
  const treatments = treatmentPaints(p.dilutions);
  const [c9, , , c6] = treatments;
  const inh = treatments.find((t) => t.kind === 'inhibitor' && t.id.startsWith('inh:inh'))!;
  p.layout = {
    ...emptyLayout('384-well'),
    wells: {
      A1: { treatments: [c9.id] },
      A4: { treatments: [c6.id] },
      B1: { treatments: [inh.id, c9.id] },
      B4: { treatments: [inh.id, c6.id] },
    },
  };
  p.layout.rowTransfection[0] = cond.id;
  p.layout.rowTransfection[1] = cond.id;
  return { p, inh, c9, c6 };
}

describe('plate layout export', () => {
  const { p, inh, c9, c6 } = demoProject();
  const transfections = transfectionPaints(p.grid);
  const treatments = treatmentPaints(p.dilutions);
  const bytes = layoutWorkbook(p, toLongTable(p.layout, transfections, treatments), transfections, treatments);

  const zip = XLSX.CFB.read(bytes, { type: 'array' });
  const styles = new TextDecoder().decode(zip.FileIndex[zip.FullPaths.findIndex((f: string) => f.endsWith('xl/styles.xml'))].content as Uint8Array);
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const plate = wb.Sheets.Plate;

  it('splits a well with two treatments into both colours, first one top left', () => {
    const first = toXlsx(tint(inh.colour, WELL_TINT));
    const second = toXlsx(tint(c6.colour, WELL_TINT));
    expect(styles).toContain(
      `<gradientFill degree="45"><stop position="0"><color rgb="FF${first}"/></stop><stop position="0.5"><color rgb="FF${first}"/></stop>` +
        `<stop position="0.5"><color rgb="FF${second}"/></stop><stop position="1"><color rgb="FF${second}"/></stop></gradientFill>`,
    );
    expect(styles).not.toContain('gray0625');
  });

  it('keeps the dose gradient: the top concentration is darker than the lowest', () => {
    const lum = (hex: string) => parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16) + parseInt(hex.slice(4, 6), 16);
    expect(lum(toXlsx(tint(c6.colour, WELL_TINT)))).toBeLessThan(lum(toXlsx(tint(c9.colour, WELL_TINT))));
    expect(styles).toContain(`rgb="FF${toXlsx(tint(c6.colour, WELL_TINT))}"`);
    expect(styles).toContain(`rgb="FF${toXlsx(tint(c9.colour, WELL_TINT))}"`);
  });

  it('names both treatments in the well and marks the transfection on its left edge', () => {
    // Title, project name, blank, column header — then row A.
    expect(plate.B6.v).toBe(`${inh.short}\n${c9.short}`);
    expect(styles).toContain(`<left style="thick"><color rgb="${toXlsx(transfections[0].colour)}"/></left>`);
  });
});
