import { useMemo } from 'react';
import {
  ASSAY_PROFILES,
  computeDilutions,
  substrateInWell,
  type AssayType,
  type CompoundBlock,
  type Placement,
} from '../calc/dilutions';
import type { Vehicle } from '../calc/types';
import { fmtUl, logMToUM, NEGLIGIBLE_RELATIVE, round } from '../calc/units';
import { exportDilutionsXlsx } from '../export/dilutionsheet';
import { wellsPerTreatment } from '../calc/layout';
import { defaultSubstrate, newSubstrateComponent, type SubstrateReference } from '../calc/substrate';
import { dilutionsWithPlate, emptyDilutions, newBufferChannel, newCompoundBlock, type Project } from '../state/project';
import { CalcField, ConfirmButton, Legend, NumField, Panel, Segmented, Warnings } from './components';

const ASSAY_TYPES = Object.keys(ASSAY_PROFILES) as AssayType[];
const VEHICLES: Vehicle[] = ['aqueous', 'DMSO'];

/** µM, shown as mM once the numbers get large enough to read badly. */
function fmtConc(uM: number): string {
  return uM >= 1000 ? `${round(uM / 1000, 3)} mM` : `${round(uM, 3)} µM`;
}

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
  const result = useMemo(() => computeDilutions(dilutionsWithPlate(project)), [project]);
  const plateWells = useMemo(() => wellsPerTreatment(project.layout), [project.layout]);

  const setExp = (patch: Partial<typeof exp>) =>
    update({ ...project, dilutions: { ...exp, ...patch } });

  const sub = exp.substrate;
  /** What the well actually receives — `null` for DERET, which has no substrate step. */
  const wellSubstrate = substrateInWell(exp);
  const fluo = exp.fluorescein;
  const tb = exp.tb;
  const wellVolume =
    exp.addition.assayBuffer_ul + (wellSubstrate?.volumePerWell_ul ?? 0) + exp.addition.compound_ul;
  const setSub = (patch: Partial<typeof sub>) => setExp({ substrate: { ...sub, ...patch } });
  const setChannel = (id: string, patch: Partial<(typeof exp.bufferChannels)[number]>) =>
    setExp({ bufferChannels: exp.bufferChannels.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

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
  /** Things that actually need making up. Plain buffer comes out of the bottle, so it is not one. */
  const toPrepare = result.recipes.filter((r) => !r.isPlainDraw && !r.isPlainBuffer && r.required_ul > 0);
  /** Portions of a prepared batch that need nothing added — allocations, not preparations. */
  const draws = result.recipes.filter((r) => r.isPlainDraw && !r.isPlainBuffer && r.required_ul > 0);

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
            {wellSubstrate && (
              <NumField
                label="Substrate added"
                unit="µl per well"
                value={wellSubstrate.volumePerWell_ul}
                step={5}
                onChange={(v) => setSub({ volumePerWell_ul: v })}
              />
            )}
            <NumField
              label="Compound solution added"
              unit="µl per well"
              value={exp.addition.compound_ul}
              onChange={(v) => setExp({ addition: { ...exp.addition, compound_ul: v } })}
            />
            <CalcField label="= well volume" unit="µl" value={wellVolume} />
            <CalcField label="= compound diluted by" unit="×" value={result.additionFactor} decimals={3} strong />
            <CalcField label="= wells the series covers" unit="wells" value={result.wellsCovered} decimals={1} />
            <div className="field">
              <label>Wells to fill</label>
              <input
                type="number"
                step="1"
                placeholder={`${round(result.wellsCovered, 1)} (from the series)`}
                value={exp.wells ?? ''}
                onChange={(e) => setExp({ wells: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <span className="unit">wells</span>
            </div>
            <NumField
              label="Extra well buffer"
              unit="µl"
              value={exp.wellBufferExtra_ul}
              step={100}
              onChange={(v) => setExp({ wellBufferExtra_ul: v })}
            />
            <p className="hint">
              All three are yours to set — the assay's defaults are only a starting point, and the
              substrate volume here is the same setting as in the Substrate panel. Any of them may
              be 0: 50 µl of compound into an empty well is a legal 1× addition.
              Each tube is prepared at {round(result.additionFactor, 3)}× the concentration you
              type, so the logM in the tables below is what the <strong>cells</strong> finally see.
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

      {exp.assayType === 'DERET' && (
        <Panel title="DERET — fluorescein & terbium">
          <div className="grid-2">
            <div>
              <h3>Fluorescein <span className="sub">in every buffer, at 1×</span></h3>
              <div className="field">
                <label>Prepare fluorescein buffer</label>
                <input
                  type="checkbox"
                  checked={fluo.enabled}
                  onChange={(e) => setExp({ fluorescein: { ...fluo, enabled: e.target.checked } })}
                  style={{ width: 16, justifySelf: 'end' }}
                />
                <span className="unit" />
              </div>
              {fluo.enabled && (
                <>
                  <div className="field">
                    <label>Wells to fill</label>
                    <input
                      type="number"
                      step="1"
                      placeholder={`${round(result.wellsCovered, 1)} (from the series)`}
                      value={exp.wells ?? ''}
                      onChange={(e) => setExp({ wells: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                    <span className="unit">wells</span>
                  </div>
                  <NumField label="Working concentration" unit="µM" value={fluo.target_uM} step={10} onChange={(v) => setExp({ fluorescein: { ...fluo, target_uM: v } })} />
                  <NumField label="Intermediate" unit="mM" value={round(fluo.intermediate_uM / 1000, 6)} step={0.5} onChange={(v) => setExp({ fluorescein: { ...fluo, intermediate_uM: v * 1000 } })} />
                  <NumField label="Freezer stock" unit="mM" value={round(fluo.stock_uM / 1000, 6)} step={10} onChange={(v) => setExp({ fluorescein: { ...fluo, stock_uM: v * 1000 } })} />
                  <NumField label="Extra intermediate" unit="µl" value={fluo.intermediateExtra_ul} step={10} onChange={(v) => setExp({ fluorescein: { ...fluo, intermediateExtra_ul: v } })} />
                  {result.fluorescein.intoBuffer && result.fluorescein.intermediate && (
                    <table style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th className="num">Make (µl)</th>
                          <th className="num">Take (µl)</th>
                          <th className="num">Into (µl)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            {fmtConc(fluo.stock_uM)} → {fmtConc(fluo.intermediate_uM)}
                            <em className="sub" style={{ display: 'block' }}>1:{round(result.fluorescein.intermediate.fold, 1)}</em>
                          </td>
                          <td className="calc num">{fmtUl(result.fluorescein.intermediate.prepare_ul)}</td>
                          <td className="calc num">{fmtUl(result.fluorescein.intermediate.stock_ul)}</td>
                          <td className="calc num">{fmtUl(result.fluorescein.intermediate.diluent_ul)}</td>
                        </tr>
                        <tr>
                          <td>
                            {fmtConc(fluo.intermediate_uM)} → {fmtConc(fluo.target_uM)} buffer
                            <em className="sub" style={{ display: 'block' }}>1:{round(result.fluorescein.intoBuffer.fold, 1)}, into the batch</em>
                          </td>
                          <td className="calc num">{fmtUl(result.fluorescein.intoBuffer.prepare_ul)}</td>
                          <td className="calc num">{fmtUl(result.fluorescein.intoBuffer.stock_ul)}</td>
                          <td className="calc num">{fmtUl(result.fluorescein.intoBuffer.diluent_ul)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  <h3 style={{ marginTop: 12 }}>What the fluorescein buffer is for</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Goes to</th>
                        <th className="num">Needed (µl)</th>
                        <th className="num">Drawn (µl)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>The cells — {round(result.wellsBuffered, 1)} wells × {fmtUl(exp.addition.assayBuffer_ul)} µl</td>
                        <td className="num">{fmtUl(result.recipes.find((r) => r.id === 'well')?.required_ul ?? 0)}</td>
                        <td className="calc num">{fmtUl(result.bufferUse.wells_ul)}</td>
                      </tr>
                      <tr>
                        <td>The compounds</td>
                        <td className="num">
                          {fmtUl(
                            ['normal', 'dmso'].reduce((a, id) => a + (result.recipes.find((r) => r.id === id)?.required_ul ?? 0), 0),
                          )}
                        </td>
                        <td className="calc num">{fmtUl(result.bufferUse.compounds_ul)}</td>
                      </tr>
                      {result.bufferUse.channels_ul > 0 && (
                        <tr>
                          <td style={{ paddingLeft: 22 }}>
                            …of that, buffer channels
                            <em className="sub"> (no compound in them)</em>
                          </td>
                          <td className="num">{fmtUl(result.bufferUse.channels_ul)}</td>
                          <td className="num">—</td>
                        </tr>
                      )}
                      <tr className="total">
                        <td>Batch prepared, rounded up</td>
                        <td className="num" />
                        <td className="num">
                          {fmtUl(result.recipes.find((r) => r.id === 'assay-buffer')?.prepare_ul ?? 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="hint">
                    Every compound diluent is drawn from that batch, so the acceptor is identical
                    before and after the compounds go in. Leave <em>wells to fill</em> blank to let
                    the compound series decide it ({round(result.wellsCovered, 1)} wells).
                  </p>
                </>
              )}
            </div>
            <div>
              <h3>Terbium <span className="sub">labels the cells first, then washed out</span></h3>
              <div className="field">
                <label>Prepare Tb</label>
                <input
                  type="checkbox"
                  checked={tb.enabled}
                  onChange={(e) => setExp({ tb: { ...tb, enabled: e.target.checked } })}
                  style={{ width: 16, justifySelf: 'end' }}
                />
                <span className="unit" />
              </div>
              {tb.enabled && (
                <>
                  <NumField label="Tb added" unit="µl per well" value={tb.volumePerWell_ul} step={10} onChange={(v) => setExp({ tb: { ...tb, volumePerWell_ul: v } })} />
                  <NumField label="Wells to label" unit="wells" value={tb.wells} step={1} onChange={(v) => setExp({ tb: { ...tb, wells: v } })} />
                  <NumField label="Dilution from stock" unit="1:N" value={tb.dilution} step={100} onChange={(v) => setExp({ tb: { ...tb, dilution: v } })} />
                  <NumField label="Extra to prepare" unit="µl" value={tb.extraVolume_ul} step={50} onChange={(v) => setExp({ tb: { ...tb, extraVolume_ul: v } })} />
                  <div className="pipette-box">
                    <CalcField label="Tb solution" unit="µl" value={result.tb.required_ul} strong />
                    <CalcField label="…of which Tb stock" unit="µl" value={result.tb.stock_ul} strong />
                  </div>
                  <CalcField label="Diluent" unit="µl" value={result.tb.diluent_ul} />
                  <p className="hint">
                    Tb goes on before everything else and is washed out once the cells are labelled,
                    so it never enters the well composition and is not DMSO-matched.
                  </p>
                </>
              )}
            </div>
          </div>
        </Panel>
      )}
      {exp.assayType !== 'DERET' && (
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
                <NumField label="Extra to prepare" unit="µl" value={sub.extraVolume_ul} step={50} onChange={(v) => setSub({ extraVolume_ul: v })} />
                <CalcField label="→ prepare" unit="µl" value={result.substrate.required_ul} strong />
                <p className="hint">
                  The well then holds {fmtUl(result.substrate.assayBufferPerWell_ul)} µl of plain{' '}
                  {result.assay.diluent} + {fmtUl(sub.volumePerWell_ul)} µl substrate +{' '}
                  {fmtUl(exp.addition.compound_ul)} µl compound. The substrate solution is made up
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
                    ? `${fmtUl(wellVolume)} µl in the well ÷ ${fmtUl(sub.volumePerWell_ul)} µl of substrate.`
                    : `${fmtUl(wellVolume - exp.addition.compound_ul)} µl before the compounds ÷ ${fmtUl(sub.volumePerWell_ul)} µl of substrate.`}{' '}
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
                      <td className="calc num">{res ? fmtUl(res.stock_ul) : ''}</td>
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
            Switch it on to work out the volumes.
          </p>
        )}
      </Panel>
      )}

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
                <div className="stacked-field">
                  <label>…in</label>
                  <Segmented
                    value={exp.bsa.placement}
                    options={[
                      { value: 'all-buffers' as Placement, label: 'every buffer' },
                      { value: 'compound-only' as Placement, label: 'only the compound' },
                    ]}
                    onChange={(v) => setExp({ bsa: { ...exp.bsa, placement: v } })}
                  />
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
                  <th>Prepare, in this order</th>
                  <th className="num">Needed (µl)</th>
                  <th className="num">Prepare (µl)</th>
                  <th className="num">Start from (µl)</th>
                  <th className="num">DMSO (µl)</th>
                  <th className="num">BSA {exp.bsa.enabled ? `${exp.bsa.stockPct} %` : ''} (µl)</th>
                  <th className="num">Other ingredients (µl)</th>
                </tr>
              </thead>
              <tbody>
                {toPrepare.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name}
                        <em className="sub" style={{ display: 'block' }}>
                          from {r.baseName}
                          {(() => {
                            const inThis = result.bufferChannels.filter(
                              (c) => c.required_ul > 0 && (c.matched ? 'dmso' : 'normal') === r.id,
                            );
                            return inThis.length > 0
                              ? ` · includes ${inThis.map((c) => `${fmtUl(c.required_ul)} µl ${c.name || 'buffer channel'}`).join(', ')}`
                              : '';
                          })()}
                        </em>
                      </td>
                      <td className="num">{fmtUl(r.required_ul)}</td>
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
                      <td className="calc num">{fmtUl(r.base_ul)}</td>
                      <td className="calc num">{r.dmso_ul > 0 ? fmtUl(r.dmso_ul) : '—'}</td>
                      <td className="calc num">{r.bsaStock_ul > 0 ? fmtUl(r.bsaStock_ul) : '—'}</td>
                      <td className="calc num">
                        {r.components.length > 0
                          ? r.components.map((c) => `${c.name}: ${fmtUl(c.volume_ul)}`).join(' · ')
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {toPrepare.length === 0 && (
              <p className="hint">Nothing to premix — every buffer here is plain {result.assay.diluent}.</p>
            )}

            {draws.length > 0 && (
              <>
                <h3 style={{ marginTop: 14 }}>Then pour off, no additions</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Take from the batch</th>
                      <th className="num">Needed (µl)</th>
                      <th className="num">Take (µl)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draws.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td className="num">{fmtUl(r.required_ul)}</td>
                        <td className="calc num">{fmtUl(r.base_ul)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">
                  These are the same buffer, just portioned out — the batch above already includes
                  them, so there is nothing extra to weigh or pipette.
                </p>
              </>
            )}

            {result.plainBuffer_ul > 0 && (
              <p className="hint">
                Plus <strong>{fmtUl(result.plainBuffer_ul)} µl of plain {result.assay.diluent}</strong>{' '}
                straight from the bottle — nothing to prepare, listed so you know what the run uses.
              </p>
            )}
            <p className="hint">
              Work down the first table, then pour off the rest. Volumes are always rounded up —
              buffers are cheap and running short mid-prep is not — and raised further when a small
              DMSO or BSA addition would otherwise be unpipettable. <strong>Type over</strong> a
              Prepare cell for a different volume; clearing it returns to the suggestion.
            </p>
            {result.recipes.some((r) => r.leftShortFor.length > 0 || r.correctedFor.length > 0) && (
              <p className="hint">
                Stocks added to a ready-made buffer displace a little of its carrier. Under{' '}
                {round(NEGLIGIBLE_RELATIVE * 100, 0)} % that is reported and left alone — a
                correction that small is less accurate than the error it removes; beyond it the app
                tops the buffer up. Either way the messages at the top say what happened.
              </p>
            )}
          </div>
        </div>
      </Panel>

      {exp.blocks.map((block) => {
        const res = result.blocks.find((b) => b.blockId === block.id)!;
        return (
          <Panel
            key={block.id}
            title={`Compound — ${block.name || 'unnamed'}${
              block.dilutionFactorOverride !== null ? ` · added at ${block.dilutionFactorOverride}×, not ${round(result.additionFactor, 3)}×` : ''
            }`}
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
                {(() => {
                  const painted = block.logM.filter((v, i) => v !== null && (plateWells[`cmp:${block.id}:${i}`] ?? 0) > 0).length;
                  const used = block.logM.filter((v) => v !== null && Number.isFinite(v)).length;
                  if (painted === 0) return null;
                  return (
                    <p className="hint">
                      The plate covers {painted} of {used} step{used === 1 ? '' : 's'} here, so{' '}
                      {painted === used ? 'each is' : 'those are'} sized from the wells painted with
                      {painted === 1 ? ' it' : ' them'} ({fmtUl(exp.addition.compound_ul)} µl a well).
                      {painted < used ? ' The figure above covers the rest.' : ''}
                    </p>
                  );
                })()}
                <div className="field">
                  <label>Added differently<em className="sub"> (optional)</em></label>
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
                <NumField label="Extra per tube" unit="µl" value={block.extraVolume_ul} step={10} onChange={(v) => setBlock(block.id, { extraVolume_ul: v })} />
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
                  <CalcField label="Stock needed" unit="µl" value={res.stockNeeded_ul} strong />
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
                        {row ? `${fmtUl(row.aliquotIn_ul)}${row.aliquotFrom === 'stock' ? ' (stock)' : ''}` : ''}
                      </td>
                      <td className="calc num">{row ? fmtUl(row.normalBuffer_ul) : ''}</td>
                      <td className="calc num">{row ? fmtUl(row.dmsoBuffer_ul) : ''}</td>
                      <td className="calc num">{row ? fmtUl(row.leftForWells_ul) : ''}</td>
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

      <Panel title="Buffer channels — wells with no compound in them">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 130 }}>Made of</th>
              <th className="num" style={{ width: 120 }}>Vol for wells (µl)</th>
              <th className="num" style={{ width: 110 }}>Extra (µl)</th>
              <th className="num" style={{ width: 110 }}>Total (µl)</th>
              <th className="no-print" style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {exp.bufferChannels.map((c) => {
              const res = result.bufferChannels.find((x) => x.id === c.id);
              return (
                <tr key={c.id}>
                  <td className="input">
                    <input style={{ textAlign: 'left' }} value={c.name} placeholder="e.g. vehicle alone" onChange={(e) => setChannel(c.id, { name: e.target.value })} />
                  </td>
                  <td className="input">
                    <select
                      value={c.vehicle}
                      onChange={(e) => setChannel(c.id, { vehicle: e.target.value as Vehicle })}
                      style={{ width: '100%', border: 'none', background: 'transparent', font: 'inherit', padding: '4px 7px' }}
                    >
                      <option value="DMSO">matched vehicle (DMSO)</option>
                      <option value="aqueous">plain buffer (aqueous)</option>
                    </select>
                  </td>
                  <td className="input">
                    <input type="number" step="any" value={c.volume_ul} onChange={(e) => setChannel(c.id, { volume_ul: Number(e.target.value) })} />
                  </td>
                  <td className="input">
                    <input type="number" step="any" value={c.extraVolume_ul} onChange={(e) => setChannel(c.id, { extraVolume_ul: Number(e.target.value) })} />
                  </td>
                  <td className="calc num">{fmtUl(res?.required_ul ?? 0)}</td>
                  <td className="no-print">
                    <ConfirmButton onConfirm={() => setExp({ bufferChannels: exp.bufferChannels.filter((x) => x.id !== c.id) })}>✕</ConfirmButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint">
          Buffer that goes into wells without a compound — a vehicle control, a buffer-only
          channel. <strong>Matched vehicle</strong> is made of the DMSO diluent, so those wells see
          the same DMSO as the treated ones{result.target > 0 ? ` (${round(result.target * 100, 3)} %)` : ' (nothing to match right now, so it is plain buffer)'};{' '}
          <strong>plain buffer</strong> carries none. They have no dilution series, so they never
          become compounds — but their volume counts towards the diluents, the batch
          {result.fluorescein.enabled ? ' and the fluorescein in it' : ''}.
        </p>
        <button className="btn no-print" style={{ marginTop: 8 }} onClick={() => setExp({ bufferChannels: [...exp.bufferChannels, newBufferChannel(`Buffer ${exp.bufferChannels.length + 1}`)] })}>
          + Add buffer channel
        </button>
      </Panel>

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
