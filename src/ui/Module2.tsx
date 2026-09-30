import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addTreatment,
  emptyLayout,
  isEdgeWell,
  isUsed,
  removeTreatment,
  reshapeLayout,
  resolveWells,
  summarise,
  toLongTable,
  transfectionPaints,
  treatmentPaints,
  type Paint,
  type PlateLayout,
  type WellState,
} from '../calc/layout';
import { inkOn, tint } from '../calc/palette';
import { PLATE_GEOMETRY } from '../calc/types';
import { exportLayoutXlsx } from '../export/layoutsheet';
import type { Project } from '../state/project';
import { Panel, Warnings } from './components';

/** What a click does: lay a paint down, or lift one off. */
type Brush =
  | { mode: 'treatment'; paint: Paint }
  | { mode: 'transfection'; paint: Paint }
  | { mode: 'erase' };

export function Module2({ project, update }: { project: Project; update: (p: Project) => void }) {
  const layout = project.layout;
  const geometry = PLATE_GEOMETRY[layout.format];

  const transfections = useMemo(() => transfectionPaints(project.grid), [project.grid]);
  const treatments = useMemo(() => treatmentPaints(project.dilutions), [project.dilutions]);
  const wells = useMemo(() => resolveWells(layout), [layout]);
  const summary = useMemo(() => summarise(layout), [layout]);

  const [brush, setBrush] = useState<Brush>({ mode: 'erase' });

  /*
   * Dragging reads and writes through refs rather than state. A drag fires faster than React
   * re-renders, so a handler built from the last render would paint from a stale plate and
   * lose wells; and the drag flag has to be readable inside a handler that was created before
   * the drag began.
   */
  const dragging = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);

  // A paint that has been deleted in another module must not stay selected.
  useEffect(() => {
    if (brush.mode === 'erase') return;
    const pool = brush.mode === 'treatment' ? treatments : transfections;
    if (!pool.some((p) => p.id === brush.paint.id)) setBrush({ mode: 'erase' });
  }, [brush, treatments, transfections]);

  const setLayout = (next: PlateLayout) => update({ ...project, layout: next });

  const applyTo = (ids: string[]) => {
    const current$ = layoutRef.current;
    const next = { ...current$.wells };
    for (const id of ids) {
      const current: WellState = next[id] ?? {};
      if (brush.mode === 'erase') {
        delete next[id];
      } else if (brush.mode === 'treatment') {
        next[id] = { ...current, treatments: addTreatment(current.treatments ?? [], brush.paint) };
      } else {
        next[id] = { ...current, transfectionId: brush.paint.id };
      }
    }
    const updated = { ...current$, wells: next };
    layoutRef.current = updated;
    setLayout(updated);
  };

  /** Right-click lifts one treatment off rather than clearing the well. */
  const liftTopTreatment = (id: string) => {
    const current = layout.wells[id];
    const top = current?.treatments?.at(-1);
    if (!top) return;
    setLayout({
      ...layout,
      wells: { ...layout.wells, [id]: { ...current, treatments: removeTreatment(current.treatments ?? [], top) } },
    });
  };

  const rowIds = (row: number) => Array.from({ length: geometry.cols }, (_, c) => `${geometry.rowLabels[row]}${c + 1}`);
  const colIds = (col: number) => Array.from({ length: geometry.rows }, (_, r) => `${geometry.rowLabels[r]}${col + 1}`);

  const paintById = useMemo(() => {
    const map = new Map<string, Paint>();
    for (const p of [...transfections, ...treatments]) map.set(p.id, p);
    return map;
  }, [transfections, treatments]);

  const name = (id: string | null) => (id ? paintById.get(id)?.label ?? '(deleted)' : '');

  const setBlockColour = (blockId: string, colour: string) =>
    update({
      ...project,
      dilutions: {
        ...project.dilutions,
        blocks: project.dilutions.blocks.map((b) => (b.id === blockId ? { ...b, colour } : b)),
        bufferChannels: project.dilutions.bufferChannels.map((c) => (c.id === blockId ? { ...c, colour } : c)),
      },
    });

  const warnings = [
    ...(summary.unseeded > 0
      ? [{ level: 'warn' as const, code: 'unseeded', scope: 'Plate', message: `${summary.unseeded} well${summary.unseeded === 1 ? ' has a treatment' : 's have treatments'} but no cells.` }]
      : []),
    ...(summary.untreated > 0
      ? [{ level: 'info' as const, code: 'untreated', scope: 'Plate', message: `${summary.untreated} well${summary.untreated === 1 ? ' has' : 's have'} cells but nothing on them yet.` }]
      : []),
    ...(summary.edgeUsed > 0
      ? [{ level: 'info' as const, code: 'edge', scope: 'Plate', message: `${summary.edgeUsed} of the ${summary.used} wells in use are on the edge, where evaporation drifts most.` }]
      : []),
  ];

  /** Compounds grouped with their steps, so a series reads as one thing with a gradient. */
  const treatmentGroups = useMemo(() => {
    const groups: { key: string; name: string; colour: string; paints: Paint[] }[] = [];
    for (const block of project.dilutions.blocks) {
      const paints = treatments.filter((p) => p.blockId === block.id);
      if (paints.length > 0) groups.push({ key: block.id, name: block.name || 'compound', colour: block.colour, paints });
    }
    const channels = treatments.filter((p) => p.kind === 'channel');
    for (const c of channels) groups.push({ key: c.id.slice(4), name: c.label, colour: c.colour, paints: [c] });
    return groups;
  }, [project.dilutions.blocks, treatments]);

  const chip = (paint: Paint, selected: boolean, onClick: () => void) => (
    <button
      key={paint.id}
      className={`chip${selected ? ' on' : ''}`}
      style={{ background: paint.colour, color: inkOn(paint.colour) }}
      onClick={onClick}
      title={paint.label}
    >
      {paint.short}
    </button>
  );

  return (
    <>
      <Warnings items={warnings} />

      <Panel title="Paints">
        <div className="grid-2">
          <div>
            <h3>Treatments <span className="sub">from module 3</span></h3>
            {treatmentGroups.length === 0 && <p className="hint">No compounds or buffer channels yet — add them in module 3.</p>}
            {treatmentGroups.map((g) => (
              <div key={g.key} className="paint-group">
                <input
                  type="color"
                  value={g.colour}
                  title={`Colour for ${g.name} — used here and in module 3`}
                  onChange={(e) => setBlockColour(g.key, e.target.value)}
                />
                <span className="paint-name">{g.name}</span>
                <span className="chips">
                  {g.paints.map((p) => chip(p, brush.mode === 'treatment' && brush.paint.id === p.id, () => setBrush({ mode: 'treatment', paint: p })))}
                </span>
              </div>
            ))}
          </div>
          <div>
            <h3>Transfections <span className="sub">from module 1</span></h3>
            {transfections.length === 0 && <p className="hint">No conditions in use yet — fill one in module 1.</p>}
            <div className="chips">
              {transfections.map((p) => chip(p, brush.mode === 'transfection' && brush.paint.id === p.id, () => setBrush({ mode: 'transfection', paint: p })))}
            </div>

            <h3 style={{ marginTop: 14 }}>Eraser</h3>
            <button
              className={`chip eraser${brush.mode === 'erase' ? ' on' : ''}`}
              onClick={() => setBrush({ mode: 'erase' })}
              title="Drag across wells to empty them"
            >
              ⌫ empty the well
            </button>
            <p className="hint">
              Pick a paint, then click a well or drag across several. Click a row or column header
              to fill it. The eraser drags the same way; right-clicking a well lifts off just its
              last treatment, leaving anything else in place.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title="Plate"
        actions={
          <button
            className="btn small no-print"
            onClick={() => setLayout(reshapeLayout(layout, layout.format === '384-well' ? '96-well' : '384-well'))}
          >
            {layout.format} → {layout.format === '384-well' ? '96' : '384'}-well
          </button>
        }
      >
        <div className="grid-scroll">
          <table className="plate">
            <thead>
              <tr>
                <th />
                {Array.from({ length: geometry.cols }, (_, col) => (
                  <th key={col} onClick={() => applyTo(colIds(col))} title={`Fill column ${col + 1}`}>{col + 1}</th>
                ))}
                <th className="plain">Cells in this row</th>
              </tr>
            </thead>
            <tbody>
              {geometry.rowLabels.map((rowLabel, row) => (
                <tr key={rowLabel}>
                  <th onClick={() => applyTo(rowIds(row))} title={`Fill row ${rowLabel}`}>{rowLabel}</th>
                  {Array.from({ length: geometry.cols }, (_, col) => {
                    const w = wells.find((x) => x.row === row && x.col === col)!;
                    const top = w.treatments.at(-1);
                    const topPaint = top ? paintById.get(top) : undefined;
                    const seed = w.transfectionId ? paintById.get(w.transfectionId) : undefined;
                    return (
                      <td
                        key={col}
                        className={`well${isUsed(w) ? ' used' : ''}${isEdgeWell(w, layout.format) ? ' edge' : ''}`}
                        style={{
                          background: topPaint ? tint(topPaint.colour, 0.3) : undefined,
                          borderLeft: seed ? `4px solid ${seed.colour}` : undefined,
                        }}
                        title={[w.id, name(w.transfectionId), ...w.treatments.map(name), w.timePoint].filter(Boolean).join(' · ')}
                        onMouseDown={(e) => { e.preventDefault(); dragging.current = true; applyTo([w.id]); }}
                        onMouseOver={() => { if (dragging.current) applyTo([w.id]); }}
                        onContextMenu={(e) => { e.preventDefault(); liftTopTreatment(w.id); }}
                      >
                        <span className="well-label">{topPaint?.short ?? ''}</span>
                        {w.treatments.length > 1 && <span className="well-more">+{w.treatments.length - 1}</span>}
                      </td>
                    );
                  })}
                  <td className="row-side">
                    <select
                      className="no-print"
                      value={layout.rowTransfection[row] ?? ''}
                      onChange={(e) =>
                        setLayout({ ...layout, rowTransfection: layout.rowTransfection.map((t, i) => (i === row ? (e.target.value === '' ? null : e.target.value) : t)) })
                      }
                    >
                      <option value="">—</option>
                      {transfections.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                    </select>
                    <input
                      className="no-print"
                      type="text"
                      value={layout.rowTime[row] ?? ''}
                      placeholder="time"
                      style={{ width: 64, marginLeft: 4 }}
                      onChange={(e) => setLayout({ ...layout, rowTime: layout.rowTime.map((t, i) => (i === row ? e.target.value : t)) })}
                    />
                    <span className="print-only">
                      {name(layout.rowTransfection[row])}{layout.rowTime[row] ? ` · ${layout.rowTime[row]}` : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend" style={{ flexWrap: 'wrap' }}>
          {[...transfections, ...treatments].map((p) => (
            <span key={p.id}>
              <span className="swatch" style={{ background: p.colour, border: `1px solid ${p.colour}` }} />
              {p.label}
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="What the plate says">
        <div className="grid-2">
          <div>
            <div className="field"><label>Wells in use</label><output className="calc">{summary.used}</output><span className="unit">of {summary.total}</span></div>
            <div className="field"><label>Cells, nothing on them</label><output className="calc">{summary.untreated}</output><span className="unit">wells</span></div>
            <div className="field"><label>Treatment, no cells</label><output className="calc">{summary.unseeded}</output><span className="unit">wells</span></div>
            <div className="field"><label>On the edge</label><output className="calc">{summary.edgeUsed}</output><span className="unit">wells</span></div>
            <p className="hint">
              Module 3 sizes each dilution step from the wells painted with it — {' '}
              {Object.keys(summary.wellsPerTreatment).length} step{Object.keys(summary.wellsPerTreatment).length === 1 ? '' : 's'} are
              covered here. A step nobody paints keeps its typed volume.
            </p>
          </div>
          <div>
            <h3>Replicates</h3>
            <table>
              <thead>
                <tr><th>Cells</th><th>Treatment</th><th>Time</th><th className="num">n</th><th>Wells</th></tr>
              </thead>
              <tbody>
                {summary.groups.map((g) => (
                  <tr key={g.key}>
                    <td>{name(g.transfectionId)}</td>
                    <td>{g.treatments.map(name).join(' + ')}</td>
                    <td>{g.timePoint}</td>
                    <td className="num">{g.wells.length}</td>
                    <td className="sub">{g.wells.join(', ')}</td>
                  </tr>
                ))}
                {summary.groups.length === 0 && <tr><td colSpan={5} className="sub">Nothing on the plate yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button className="btn primary" onClick={() => exportLayoutXlsx(project, toLongTable(layout, transfections, treatments), transfections, treatments)}>
          Export layout (Excel)
        </button>
        <button className="btn" onClick={() => window.print()}>Print plate</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setLayout(emptyLayout(layout.format))} title="Empty every well">Clear plate</button>
      </div>
    </>
  );
}
