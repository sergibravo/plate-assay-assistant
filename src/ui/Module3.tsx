import { useMemo } from 'react';
import {
  ASSAY_PROFILES,
  computeDilutions,
  type AssayType,
  type CompoundBlock,
} from '../calc/dilutions';
import type { Vehicle } from '../calc/types';
import { fmtVol, logMToUM, round } from '../calc/units';
import { exportDilutionsXlsx } from '../export/dilutionsheet';
import { emptyDilutions, newCompoundBlock, type Project } from '../state/project';
import { CalcField, ConfirmButton, Legend, NumField, Panel, Segmented, Warnings } from './components';

const ASSAY_TYPES = Object.keys(ASSAY_PROFILES) as AssayType[];
const VEHICLES: Vehicle[] = ['aqueous', 'DMSO'];

/** Concentration shown next to the logM the user typed. */
function concLabel(logM: number | null): string {
  if (logM === null || !Number.isFinite(logM)) return '';
  const uM = logMToUM(logM);
  if (uM >= 1000) return `${round(uM / 1000, 3)} mM`;
  if (uM >= 1) return `${round(uM, 3)} µM`;
  return `${round(uM * 1000, 3)} nM`;
}

export function Module3({ project, update }: { project: Project; update: (p: Project) => void }) {
  // Projects are migrated on open, so this section is always present — but a missing one
  // must never blank the screen in the middle of an experiment.
  const exp = project.dilutions ?? emptyDilutions();
  const result = useMemo(() => computeDilutions(exp), [exp]);

  const setExp = (patch: Partial<typeof exp>) =>
    update({ ...project, dilutions: { ...exp, ...patch } });

  const setBlock = (id: string, patch: Partial<CompoundBlock>) =>
    setExp({ blocks: exp.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const setLogM = (id: string, row: number, value: number | null) =>
    setExp({
      blocks: exp.blocks.map((b) =>
        b.id === id ? { ...b, logM: b.logM.map((v, i) => (i === row ? value : v)) } : b,
      ),
    });

  /** Fill a block downwards from its top row in even log steps — the usual dose-response. */
  const fillSeries = (block: CompoundBlock, step: number) => {
    const top = block.logM.find((v) => v !== null && Number.isFinite(v));
    if (top === null || top === undefined) return;
    setBlock(block.id, { logM: block.logM.map((_, i) => round(top - i * step, 6)) });
  };

  const pct = (x: number) => `${round(x * 100, 4)} %`;

  return (
    <>
      <Warnings items={result.warnings} />

      <Panel title="Assay">
        <div className="field" style={{ maxWidth: 640 }}>
          <label>Assay type</label>
          <div style={{ gridColumn: '2 / span 2' }}>
            <Segmented
              value={exp.assayType}
              options={ASSAY_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(v) => setExp({ assayType: v })}
            />
          </div>
        </div>
        <p className="hint">
          Compounds are diluted in <strong>{result.assay.diluent}</strong>. The two diluents below are
          premixed and used to top every tube up to the same DMSO %.
        </p>
        {result.assay.pending.map((note, i) => (
          <div key={i} className={`msg ${result.assay.compoundsComplete ? 'info' : 'warn'} no-print`}>
            {note}
          </div>
        ))}
      </Panel>

      <Panel title="DMSO vehicle matching">
        <div className="grid-2">
          <div>
            <p className="hint" style={{ margin: '0 0 8px' }}>
              These are DMSO <strong>concentrations</strong>, not volumes: the % every tube is
              brought to, so DMSO is the same in every compound well.
            </p>
            <CalcField
              label="Needed by the worst DMSO stock"
              unit="% DMSO"
              value={result.computedTarget * 100}
              decimals={4}
            />
            <div className="field">
              <label>Force a different % (optional)</label>
              <input
                type="number"
                step="any"
                placeholder="auto"
                value={exp.dmsoOverride === null ? '' : round(exp.dmsoOverride * 100, 6)}
                onChange={(e) =>
                  setExp({ dmsoOverride: e.target.value === '' ? null : Number(e.target.value) / 100 })
                }
              />
              <span className="unit">% DMSO</span>
            </div>
            <CalcField label="Used — DMSO in every tube" unit="% DMSO" value={result.target * 100} decimals={4} strong />
            <NumField
              label="In-well dilution on addition"
              unit="×"
              value={exp.inWellFactor}
              step={0.5}
              onChange={(v) => setExp({ inWellFactor: v })}
            />
            <CalcField label="→ DMSO in the well" unit="% DMSO" value={result.inWellDmso * 100} decimals={4} strong />
          </div>
          <div>
            <h3>Premix for the whole experiment</h3>
            <div className="pipette-box">
              <CalcField label={result.assay.normalBufferName} unit="µl" value={result.totalNormalBuffer_ul} strong />
              <CalcField label={result.assay.dmsoBufferName} unit="µl" value={result.totalDmsoBuffer_ul} strong />
            </div>
            <p className="hint">
              {result.target > 0 ? (
                <>
                  The DMSO diluent is {result.assay.diluent} premixed at {pct(result.target)} DMSO. Every
                  compound well then lands at {pct(result.inWellDmso)} DMSO, whatever its stock was
                  dissolved in.
                </>
              ) : (
                <>No compound uses a DMSO stock, so nothing needs matching — every tube is made up with plain {result.assay.diluent}.</>
              )}
            </p>
            <div className="field" style={{ gridTemplateColumns: '1fr' }}>
              <label style={{ marginBottom: 4 }}>Buffer recipes / notes (printed on the bench sheet)</label>
            </div>
            <textarea
              value={exp.bufferNotes}
              placeholder={'e.g. 30 % H₂O buffer = 1.2 ml H₂O dd + 2.8 ml HBSS'}
              onChange={(e) => setExp({ bufferNotes: e.target.value })}
              rows={3}
              style={{ width: '100%', font: 'inherit', padding: 6, borderRadius: 4, border: '1px solid #e0c94a', background: '#fff8c4' }}
            />
          </div>
        </div>
        <Legend />
      </Panel>

      <Panel title="BSA carrier">
        <div className="grid-2">
          <div>
            <div className="field">
              <label>Add BSA to the diluents</label>
              <input
                type="checkbox"
                checked={exp.bsa.enabled}
                onChange={(e) => setExp({ bsa: { ...exp.bsa, enabled: e.target.checked } })}
                style={{ width: 16, justifySelf: 'end' }}
              />
              <span className="unit" />
            </div>
            {exp.bsa.enabled && (
              <>
                <NumField
                  label="BSA wanted"
                  unit="% (w/v)"
                  value={exp.bsa.targetPct}
                  step={0.001}
                  onChange={(v) => setExp({ bsa: { ...exp.bsa, targetPct: v } })}
                />
                <div className="field">
                  <label>…measured in</label>
                  <div style={{ gridColumn: '2 / span 2' }}>
                    <Segmented
                      value={exp.bsa.basis}
                      options={[
                        { value: 'buffer' as const, label: 'the prepared buffer' },
                        { value: 'in-well' as const, label: 'the final well' },
                      ]}
                      onChange={(v) => setExp({ bsa: { ...exp.bsa, basis: v } })}
                    />
                  </div>
                </div>
                <NumField
                  label="BSA stock"
                  unit="% (w/v)"
                  value={exp.bsa.stockPct}
                  step={0.5}
                  onChange={(v) => setExp({ bsa: { ...exp.bsa, stockPct: v } })}
                />
                <CalcField label="Diluents premixed at" unit="% BSA" value={result.bsaBufferFraction * 100} decimals={4} strong />
                <CalcField label="→ BSA in the well" unit="% BSA" value={result.bsaInWell * 100} decimals={4} />
                <p className="hint">
                  Both diluents carry the same BSA, so it stays constant across every compound.
                  A compound whose stock already contains BSA can declare it in its own block; a
                  stock without BSA leaves its top tube a hair under target, which is reported.
                </p>
              </>
            )}
          </div>
          <div>
            <h3>Premix recipe</h3>
            <table>
              <thead>
                <tr>
                  <th>Diluent</th>
                  <th className="num">Prepare (µl)</th>
                  <th className="num">{result.assay.diluent} (µl)</th>
                  <th className="num">DMSO (µl)</th>
                  <th className="num">BSA {exp.bsa.enabled ? `${exp.bsa.stockPct} %` : ''} (µl)</th>
                </tr>
              </thead>
              <tbody>
                {result.recipes.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="calc num">{r.prepare_ul}</td>
                    <td className="calc num">{fmtVol(r.base_ul, 2)}</td>
                    <td className="calc num">{r.dmso_ul > 0 ? fmtVol(r.dmso_ul, 3) : '—'}</td>
                    <td className="calc num">{r.bsaStock_ul > 0 ? fmtVol(r.bsaStock_ul, 3) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Volumes are what the compound blocks consume, rounded up to whole µl. Slack comes
              from each compound's own margin.
            </p>
          </div>
        </div>
      </Panel>

      {exp.blocks.map((block) => {
        const res = result.blocks.find((b) => b.blockId === block.id)!;
        return (
          <Panel
            key={block.id}
            title={`Compound — ${block.name || 'unnamed'}`}
            actions={
              <div className="no-print" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn small" onClick={() => fillSeries(block, 1)} title="Fill the rows below the top one in whole-log steps">
                  Fill ×10
                </button>
                <button className="btn small" onClick={() => fillSeries(block, 0.5)} title="Fill the rows below the top one in half-log steps">
                  Fill ½-log
                </button>
                <ConfirmButton
                  className="btn small"
                  title="Delete this compound block"
                  disabled={exp.blocks.length <= 1}
                  onConfirm={() => setExp({ blocks: exp.blocks.filter((b) => b.id !== block.id) })}
                >
                  ✕
                </ConfirmButton>
              </div>
            }
          >
            <div className="grid-2">
              <div>
                <div className="field">
                  <label>Compound name</label>
                  <input
                    type="text"
                    value={block.name}
                    onChange={(e) => setBlock(block.id, { name: e.target.value })}
                    style={{ gridColumn: '2 / span 2' }}
                  />
                </div>
                <NumField label="Vol for wells" unit="µl" value={block.volForWells_ul} onChange={(v) => setBlock(block.id, { volForWells_ul: v })} />
                <NumField label="Dilution factor on addition" unit="×" value={block.dilutionFactor} step={0.5} onChange={(v) => setBlock(block.id, { dilutionFactor: v })} />
                <NumField label="Stock concentration" unit="µM" value={block.stockConc_uM} onChange={(v) => setBlock(block.id, { stockConc_uM: v })} />
                <div className="field">
                  <label>Stock vehicle</label>
                  <select value={block.vehicle} onChange={(e) => setBlock(block.id, { vehicle: e.target.value as Vehicle })}>
                    {VEHICLES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <span className="unit" />
                </div>
                <NumField label="Margin" unit="×" value={block.margin} step={0.1} onChange={(v) => setBlock(block.id, { margin: v })} />
                {exp.bsa.enabled && (
                  <div className="field">
                    <label>BSA already in this stock</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="none"
                      value={block.stockBsaPct ?? ''}
                      onChange={(e) => setBlock(block.id, { stockBsaPct: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                    <span className="unit">% (w/v)</span>
                  </div>
                )}
                <div className="field">
                  <label>Exclude from DMSO matching</label>
                  <input
                    type="checkbox"
                    checked={block.excludeFromVehicleMatch}
                    onChange={(e) => setBlock(block.id, { excludeFromVehicleMatch: e.target.checked })}
                    style={{ width: 16, justifySelf: 'end' }}
                  />
                  <span className="unit">never matched</span>
                </div>
              </div>
              <div>
                <h3>This block</h3>
                <div className="pipette-box">
                  <CalcField label="Stock needed" unit="µl" value={res.stockNeeded_ul} decimals={3} strong />
                </div>
                <CalcField label={result.assay.normalBufferName} unit="µl" value={res.totalNormalBuffer_ul} />
                <CalcField label={result.assay.dmsoBufferName} unit="µl" value={res.totalDmsoBuffer_ul} />
                {res.unmatched && !res.isEmpty && (
                  <p className="hint">
                    {block.excludeFromVehicleMatch
                      ? 'Excluded from matching — made up with DMSO-free diluent only.'
                      : 'Nothing to match: no DMSO in this experiment.'}
                  </p>
                )}
              </div>
            </div>

            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th className="num" style={{ width: 90 }}>Conc. (logM)</th>
                  <th className="num">In well</th>
                  <th className="num">In tube (µM)</th>
                  <th className="num">Vol to prepare (µl)</th>
                  <th className="num">From prev. or stock (µl)</th>
                  <th className="num">{result.assay.normalBufferName} (µl)</th>
                  <th className="num">{result.assay.dmsoBufferName} (µl)</th>
                  <th className="num">Left for wells (µl)</th>
                </tr>
              </thead>
              <tbody>
                {block.logM.map((logM, i) => {
                  const row = res.rows[i];
                  return (
                    <tr key={i}>
                      <td className="input">
                        <input
                          type="number"
                          step="any"
                          value={logM ?? ''}
                          placeholder={i === 0 ? 'e.g. −5' : ''}
                          onChange={(e) => setLogM(block.id, i, e.target.value === '' ? null : Number(e.target.value))}
                        />
                      </td>
                      <td className="num">{concLabel(logM)}</td>
                      <td className="calc num">{row ? round(row.tubeConc_uM, 4) : ''}</td>
                      <td className="calc num">{row ? row.volToPrepare_ul : ''}</td>
                      <td className="calc num">
                        {row ? `${fmtVol(row.aliquotIn_ul, 3)}${row.aliquotFrom === 'stock' ? ' (stock)' : ''}` : ''}
                      </td>
                      <td className="calc num">{row ? fmtVol(row.normalBuffer_ul, 2) : ''}</td>
                      <td className="calc num">{row ? fmtVol(row.dmsoBuffer_ul, 2) : ''}</td>
                      <td className="calc num">{row ? fmtVol(row.leftForWells_ul, 2) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button className="btn small" onClick={() => setBlock(block.id, { logM: [...block.logM, null] })}>+ Row</button>
              <button
                className="btn small"
                disabled={block.logM.length <= 1}
                onClick={() => setBlock(block.id, { logM: block.logM.slice(0, -1) })}
              >
                − Row
              </button>
              <input
                type="text"
                value={block.notes}
                placeholder="notes for this compound (printed on the bench sheet)"
                onChange={(e) => setBlock(block.id, { notes: e.target.value })}
                style={{ flex: 1, font: 'inherit', padding: '3px 7px', borderRadius: 4, border: '1px solid #e0c94a', background: '#fff8c4' }}
              />
            </div>
          </Panel>
        );
      })}

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button
          className="btn"
          onClick={() => setExp({ blocks: [...exp.blocks, newCompoundBlock(`Compound ${exp.blocks.length + 1}`)] })}
        >
          + Add compound
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => exportDilutionsXlsx(project, result)}>
          Export bench sheet (Excel)
        </button>
        <button className="btn" onClick={() => window.print()}>Print bench sheet</button>
      </div>
    </>
  );
}
