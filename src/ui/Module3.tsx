import { useMemo } from 'react';
import {
  ASSAY_PROFILES,
  computeDilutions,
  type AssayType,
  type CompoundBlock,
  type Placement,
} from '../calc/dilutions';
import type { Vehicle } from '../calc/types';
import { fmtVol, logMToUM, round } from '../calc/units';
import { exportDilutionsXlsx } from '../export/dilutionsheet';
import { defaultSubstrate, newSubstrateComponent, type SubstrateReference } from '../calc/substrate';
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

  const sub = exp.substrate;
  const wellVolume =
    exp.addition.assayBuffer_ul + (sub.enabled ? sub.volumePerWell_ul : 0) + exp.addition.compound_ul;
  const setSub = (patch: Partial<typeof sub>) => setExp({ substrate: { ...sub, ...patch } });
  const setComponent = (id: string, patch: Partial<(typeof sub.components)[number]>) =>
    setSub({ components: sub.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

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

      <Panel title="Adding compound to the well">
        <div className="grid-2">
          <div>
            <NumField
              label="Assay buffer in the well"
              unit="µl per well"
              value={exp.addition.assayBuffer_ul}
              onChange={(v) => setExp({ addition: { ...exp.addition, assayBuffer_ul: v } })}
            />
            {sub.enabled && (
              <div className="field">
                <label>Substrate added</label>
                <output className="calc">{fmtVol(sub.volumePerWell_ul, 1)}</output>
                <span className="unit">µl per well</span>
              </div>
            )}
            <NumField
              label="Compound solution added"
              unit="µl per well"
              value={exp.addition.compound_ul}
              onChange={(v) => setExp({ addition: { ...exp.addition, compound_ul: v } })}
            />
            <CalcField label="= well volume" unit="µl" value={wellVolume} decimals={1} />
            <CalcField label="= compound diluted by" unit="×" value={result.additionFactor} decimals={3} strong />
            <p className="hint">
              Any of these may be 0 — 50 µl of compound into an empty well is a 1× addition.
              Each tube is prepared at {round(result.additionFactor, 3)}× the concentration you
              type, so the logM in the tables below is what the <strong>cells</strong> finally see.
              {sub.enabled ? ' The substrate volume is set in the Substrate panel.' : ''}
            </p>
          </div>
          <div>
            <h3>Where the DMSO sits</h3>
            <Segmented
              value={exp.dmsoPlacement}
              options={[
                { value: 'compound-only' as Placement, label: 'Only in the compound' },
                { value: 'all-buffers' as Placement, label: 'In every buffer' },
              ]}
              onChange={(v) => setExp({ dmsoPlacement: v })}
            />
            <p className="hint" style={{ marginTop: 8 }}>
              <strong>Only in the compound:</strong> everything else in the well is DMSO-free, and
              all the DMSO arrives with the {exp.addition.compound_ul} µl addition — matched across
              compounds, so they all spike identically.
              <br />
              <strong>In every buffer:</strong> the well buffer is premixed at the same DMSO as the
              tubes, so the concentration never changes — steadier for the cells, but the final
              DMSO is {round(result.additionFactor, 3)}× higher.
            </p>
          </div>
        </div>
        <Legend />
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
            <CalcField label="→ DMSO in the well" unit="% DMSO" value={result.inWellDmso * 100} decimals={4} strong />
            <p className="hint">
              {exp.dmsoPlacement === 'all-buffers'
                ? 'Every buffer carries the same DMSO, so the well is at that % from the start and nothing changes when the compound goes in.'
                : `Only the compound tubes carry DMSO, so the well lands ${round(result.additionFactor, 3)}× lower — the cells meet DMSO for the first time when the compound is added.`}
            </p>
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

      <Panel
        title="Substrate"
        actions={
          <div className="no-print" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: '#667085' }}>load defaults:</span>
            {(['NanoBiT/BRET', 'HiBiT'] as const).map((a) => (
              <button
                key={a}
                className="btn small"
                title={`Replace these settings with the usual ${a} recipe`}
                onClick={() => setExp({ substrate: defaultSubstrate(a) })}
              >
                {a}
              </button>
            ))}
            <div className="field" style={{ margin: 0, gridTemplateColumns: 'auto auto' }}>
              <label style={{ fontSize: 11.5, color: '#667085' }}>prepare substrate</label>
              <input
                type="checkbox"
                checked={sub.enabled}
                onChange={(e) => setSub({ enabled: e.target.checked })}
                style={{ width: 16 }}
              />
            </div>
          </div>
        }
      >
        {sub.enabled ? (
          <>
            <div className="grid-2">
              <div>
                <NumField label="Substrate added" unit="µl per well" value={sub.volumePerWell_ul} onChange={(v) => setSub({ volumePerWell_ul: v })} />
                <NumField label="Wells to measure" unit="wells" value={sub.wells} step={1} onChange={(v) => setSub({ wells: v })} />
                <NumField label="Margin" unit="×" value={sub.margin} step={0.1} onChange={(v) => setSub({ margin: v })} />
                <CalcField label="→ prepare" unit="µl" value={result.substrate.required_ul} decimals={1} strong />
                <p className="hint">
                  The well then holds {fmtVol(result.substrate.assayBufferPerWell_ul, 1)} µl of plain{' '}
                  {result.assay.diluent} + {fmtVol(sub.volumePerWell_ul, 1)} µl substrate +{' '}
                  {fmtVol(exp.addition.compound_ul, 1)} µl compound. The substrate solution is made up
                  in the same {result.assay.diluent} as the well, so it carries whatever that does.
                </p>
              </div>
              <div>
                <div className="stacked-field">
                  <label>Dilutions below hold</label>
                  <Segmented
                    value={sub.reference}
                    options={[
                      { value: 'after-compounds' as SubstrateReference, label: 'once compounds are in' },
                      { value: 'before-compounds' as SubstrateReference, label: 'before compounds' },
                    ]}
                    onChange={(v) => setSub({ reference: v })}
                  />
                </div>
                <CalcField label="= diluted in the well by" unit="×" value={result.substrate.foldFactor} decimals={3} strong />
                <p className="hint">
                  {sub.reference === 'after-compounds'
                    ? `${fmtVol(wellVolume, 1)} µl in the well ÷ ${fmtVol(sub.volumePerWell_ul, 1)} µl of substrate.`
                    : `${fmtVol(wellVolume - exp.addition.compound_ul, 1)} µl before the compounds ÷ ${fmtVol(sub.volumePerWell_ul, 1)} µl of substrate.`}{' '}
                  Everything below is quoted as the final concentration in the well; the app works
                  back to what goes in the tube.
                </p>
              </div>
            </div>

            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="num" style={{ width: 130 }}>1:N in the well</th>
                  <th className="num">1:N in the solution</th>
                  <th className="num">Stock to add (µl)</th>
                  <th>Notes</th>
                  <th className="no-print" style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {sub.components.map((c, i) => {
                  const res = result.substrate.components[i];
                  return (
                    <tr key={c.id}>
                      <td className="input">
                        <input style={{ textAlign: 'left' }} value={c.name} onChange={(e) => setComponent(c.id, { name: e.target.value })} />
                      </td>
                      <td className="input">
                        <input type="number" step="any" value={c.dilution} onChange={(e) => setComponent(c.id, { dilution: Number(e.target.value) })} />
                      </td>
                      <td className="calc num">{res ? round(res.preparedDilution, 2) : ''}</td>
                      <td className="calc num">{res ? fmtVol(res.stock_ul, 3) : ''}</td>
                      <td className="input">
                        <input style={{ textAlign: 'left' }} value={c.notes} onChange={(e) => setComponent(c.id, { notes: e.target.value })} />
                      </td>
                      <td className="no-print">
                        <ConfirmButton onConfirm={() => setSub({ components: sub.components.filter((x) => x.id !== c.id) })}>✕</ConfirmButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              className="btn small no-print"
              style={{ marginTop: 8 }}
              onClick={() => setSub({ components: [...sub.components, newSubstrateComponent('')] })}
            >
              + Component
            </button>
          </>
        ) : (
          <p className="hint">
            No substrate prepared for this experiment.{' '}
            {exp.assayType === 'DERET'
              ? 'For DERET the compounds themselves are diluted in furimazine — that preparation is not calculated yet.'
              : 'Switch it on to work out the volumes.'}
          </p>
        )}
      </Panel>

      <Panel title="BSA carrier & premix recipe">
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
                  <label>…in</label>
                  <div style={{ gridColumn: '2 / span 2' }}>
                    <Segmented
                      value={exp.bsa.placement}
                      options={[
                        { value: 'all-buffers' as Placement, label: 'every buffer' },
                        { value: 'compound-only' as Placement, label: 'only the compound' },
                      ]}
                      onChange={(v) => setExp({ bsa: { ...exp.bsa, placement: v } })}
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
                  {exp.bsa.placement === 'all-buffers'
                    ? 'Every buffer — the compound diluents and the buffer already in the well — is prepared at this %, so the well sits at it too.'
                    : `Only the compound diluents carry BSA, so the well lands ${round(result.additionFactor, 3)}× lower.`}{' '}
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
                  <th className="num">Needed (µl)</th>
                  <th className="num">Prepare (µl)</th>
                  <th className="num">{result.assay.diluent} (µl)</th>
                  <th className="num">DMSO (µl)</th>
                  <th className="num">BSA {exp.bsa.enabled ? `${exp.bsa.stockPct} %` : ''} (µl)</th>
                  <th className="num">Other ingredients (µl)</th>
                </tr>
              </thead>
              <tbody>
                {result.recipes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="num">{fmtVol(r.required_ul, 1)}</td>
                    <td className="input">
                      <input
                        type="number"
                        step="any"
                        placeholder={String(r.suggested_ul)}
                        title={r.overridden ? `Clear to go back to the suggested ${r.suggested_ul} µl` : 'Suggested — type a different volume to prepare more'}
                        value={exp.premixOverrides[r.id] ?? ''}
                        onChange={(e) =>
                          setExp({
                            premixOverrides: {
                              ...exp.premixOverrides,
                              [r.id]: e.target.value === '' ? null : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </td>
                    <td className="calc num">{fmtVol(r.base_ul, 2)}</td>
                    <td className="calc num">{r.dmso_ul > 0 ? fmtVol(r.dmso_ul, 3) : '—'}</td>
                    <td className="calc num">{r.bsaStock_ul > 0 ? fmtVol(r.bsaStock_ul, 3) : '—'}</td>
                    <td className="calc num">
                      {r.components.length > 0
                        ? r.components.map((c) => `${c.name}: ${fmtVol(c.volume_ul, 3)}`).join(' · ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              The suggestion is always rounded up — buffers are cheap and running short mid-prep
              is not — and raised further when a small DMSO or BSA addition would otherwise be
              unpipettable, which is called out at the top. <strong>Type over it</strong> to
              prepare a different volume; the DMSO and BSA are recalculated for whatever you
              enter, and clearing the cell returns to the suggestion.
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
                <div className="field">
                  <label>Added differently (optional)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder={`${round(result.additionFactor, 3)}×`}
                    value={block.dilutionFactorOverride ?? ''}
                    onChange={(e) => setBlock(block.id, { dilutionFactorOverride: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                  <span className="unit">× dilution</span>
                </div>
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
