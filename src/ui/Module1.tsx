import { useMemo, useState } from 'react';
import { computeGrid, masterMix, perCondition, unitLabel, unitRecipe, validateParams } from '../calc/transfection';
import { defaultDish, DISH_DEFAULTS, type DishParams, type DishSize, type DnaStock, type PlateFormat } from '../calc/types';
import { fmtUl, round } from '../calc/units';
import { exportTransfectionXlsx } from '../export/benchsheet';
import {
  addColumn,
  addRowGroup,
  clearCondition,
  enableCondition,
  reconcileGrid,
  removeColumn,
  removeRowGroup,
  uid,
  updateCondition,
  type Project,
} from '../state/project';
import { CalcField, ConfirmButton, Legend, NumField, Panel, Segmented, SelectField, TextField, Warnings } from './components';

const PLATE_FORMATS: readonly PlateFormat[] = ['96-well', 'half-area 96-well', '384-well'];
const DISH_SIZES: readonly DishSize[] = ['6-well', '6 cm', '10 cm'];

export function Module1({ project, update }: { project: Project; update: (p: Project) => void }) {
  const { transfection: p, dnaStocks, grid } = project;

  const recipe = useMemo(() => unitRecipe(p), [p]);
  const unit = recipe.unit;
  const per = useMemo(() => perCondition(p), [p]);
  const gridResult = useMemo(() => computeGrid(p, grid, dnaStocks), [p, grid, dnaStocks]);
  // With nothing in use yet, show what one condition at the default count would need.
  const mix = useMemo(
    () => masterMix(p, gridResult.activeUnits.length > 0 ? gridResult.activeUnits : 1),
    [p, gridResult.activeUnits],
  );
  const paramWarnings = useMemo(() => validateParams(p), [p]);

  const setParam = <K extends keyof typeof p>(key: K, value: (typeof p)[K]) =>
    update({ ...project, transfection: { ...p, [key]: value } });

  const setDish = <K extends keyof DishParams>(key: K, value: DishParams[K]) => setParam('dish', { ...p.dish, [key]: value });
  // A new size loads its own defaults; the extras are the user's and stay.
  const setDishSize = (size: DishSize) =>
    setParam('dish', { ...defaultDish(size), mixExtra_ul: p.dish.mixExtra_ul, cellExtra_ul: p.dish.cellExtra_ul });
  const dishDefaults = DISH_DEFAULTS[p.dish.size];
  const dishEdited = (Object.keys(dishDefaults) as (keyof typeof dishDefaults)[]).some((k) => p.dish[k] !== dishDefaults[k]);

  /** This condition's own well or dish count; `null` returns it to the default. */
  const setUnits = (conditionId: string, n: number | null) =>
    setGrid(updateCondition(grid, conditionId, (c) => (unit === 'dish' ? { ...c, dishes: n } : { ...c, wells: n })));

  const setStocks = (stocks: DnaStock[]) =>
    update({ ...project, dnaStocks: stocks, grid: reconcileGrid(grid, stocks) });

  const setGrid = (next: typeof grid) => update({ ...project, grid: next });

  const setPct = (conditionId: string, stockId: string, pct: number | null) =>
    setGrid(
      updateCondition(grid, conditionId, (c) => ({
        ...c,
        entries: c.entries.map((e) => (e.dnaStockId === stockId ? { ...e, pct } : e)),
      })),
    );

  const colTemplate = `repeat(${grid.cols}, 246px)`;
  const fillerId = dnaStocks.find((s) => s.isFiller)?.id ?? null;

  // Drag to reorder the inventory. The grid follows, because every condition's rows are
  // rebuilt from the inventory order whenever the stocks change.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const moveStock = (from: number, to: number) => {
    if (from === to || to < 0 || to >= dnaStocks.length) return;
    const next = [...dnaStocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setStocks(next);
  };

  return (
    <>
      <Warnings items={[...paramWarnings, ...gridResult.warnings]} />

      <Panel
        title="Setup — global parameters"
        actions={
          <div className="no-print" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: '#667085' }}>Transfect in:</span>
            <Segmented
              value={p.mode}
              options={[
                { value: 'plate', label: '96-well plate (reverse)' },
                { value: 'dish', label: 'Dish' },
              ]}
              onChange={(v) => setParam('mode', v)}
            />
          </div>
        }
      >
        <div className="grid-2">
          {p.mode === 'plate' ? (
            <div>
              <h3>General</h3>
              <NumField label="Wells per condition" unit="wells" value={p.wellsPerCondition} min={1} step={1} onChange={(v) => setParam('wellsPerCondition', v)} />
              <NumField label="DNA per well" unit="ng" value={p.dna_ng_per_well} onChange={(v) => setParam('dna_ng_per_well', v)} />
              <NumField label="OptiMEM per well" unit="µl" value={p.optimem_ul_per_well} onChange={(v) => setParam('optimem_ul_per_well', v)} />
              <NumField label="PEI:DNA ratio" unit="w/w" value={p.peiDnaRatio} onChange={(v) => setParam('peiDnaRatio', v)} />
              <NumField label="Extra transfection mix" unit="µl" value={p.transfectionMixExtra_ul} step={10} onChange={(v) => setParam('transfectionMixExtra_ul', v)} />
              <NumField label="Extra cell suspension" unit="µl" value={p.cellSuspensionExtra_ul} step={100} onChange={(v) => setParam('cellSuspensionExtra_ul', v)} />
              <p className="hint">
                Wells per condition is the default; a condition can set its own count in its block
                below (e.g. 32 wells for a CRC, 8 for a control). Every well gets the same mix — a
                smaller condition just makes less of it. Include your spare wells in the count.
                Extra is an <strong>amount</strong>, not a percentage: the mix extra keeps the
                PEI:OptiMEM ratio; the suspension extra carries its own cells at the seeding density.
              </p>
            </div>
          ) : (
            <div>
              <h3>Dish</h3>
              <SelectField label="Dish" value={p.dish.size} options={DISH_SIZES} onChange={setDishSize} />
              <NumField label="DNA per dish" unit="µg" value={p.dish.dna_ug} step={0.1} onChange={(v) => setDish('dna_ug', v)} />
              <NumField label="OptiMEM for DNA" unit="µl / dish" value={p.dish.optimemForDna_ul} step={10} onChange={(v) => setDish('optimemForDna_ul', v)} />
              <NumField label="OptiMEM for PEI" unit="µl / dish" value={p.dish.optimemForPei_ul} step={10} onChange={(v) => setDish('optimemForPei_ul', v)} />
              <NumField label="PEI:DNA ratio" unit="w/w" value={p.peiDnaRatio} onChange={(v) => setParam('peiDnaRatio', v)} />
              <NumField label="Extra transfection mix" unit="µl" value={p.dish.mixExtra_ul} step={10} onChange={(v) => setDish('mixExtra_ul', v)} />
              <NumField label="Extra cell suspension" unit="µl" value={p.dish.cellExtra_ul} step={100} onChange={(v) => setDish('cellExtra_ul', v)} />
              <p className="hint">
                {p.dish.size === '6-well' ? 'Values are per well of the 6-well plate. ' : ''}
                Choosing a dish loads its defaults (6 cm is the reference; 6-well and 10 cm are
                scaled by growth area); every value can then be changed.
                {dishEdited && (
                  <>
                    {' '}
                    <button className="btn small no-print" onClick={() => setDishSize(p.dish.size)}>
                      Reset to {p.dish.size} defaults
                    </button>
                  </>
                )}{' '}
                One dish per condition unless a block below says otherwise.
              </p>
            </div>
          )}
          <div>
            <h3>Cells</h3>
            <TextField label="Cell line" value={p.cellLine} placeholder="e.g. HEK293 parental" onChange={(v) => setParam('cellLine', v)} />
            {p.mode === 'plate' ? (
              <>
                <NumField label="Cells per well" unit="k cells" value={p.cells_k_per_well} step={1} onChange={(v) => setParam('cells_k_per_well', v)} />
                <NumField label="DMEM per well" unit="µl" value={p.dmem_ul_per_well} onChange={(v) => setParam('dmem_ul_per_well', v)} />
                <SelectField label="Plate format" value={p.plateFormat} options={PLATE_FORMATS} onChange={(v) => setParam('plateFormat', v)} />
              </>
            ) : (
              <>
                <NumField label="Cells per dish" unit="M cells" value={p.dish.cells_M} step={0.1} onChange={(v) => setDish('cells_M', v)} />
                <NumField label="DMEM per dish" unit="ml" value={p.dish.medium_ml} step={0.5} onChange={(v) => setDish('medium_ml', v)} />
                <p className="hint">The cells go in with the transfection mix, as on the plate.</p>
              </>
            )}
          </div>
          <div>
            <h3>Reagents</h3>
            <NumField label="PEI stock" unit="µg/µl" value={p.pei_ug_per_ul} step={0.1} onChange={(v) => setParam('pei_ug_per_ul', v)} />
            <TextField label="OptiMEM lot #" value={p.optimemLot} onChange={(v) => setParam('optimemLot', v)} />
            <TextField label="PEI lot #" value={p.peiLot} onChange={(v) => setParam('peiLot', v)} />
          </div>
          <div>
            <h3>Calculated summary <span className="sub">per condition of {unitLabel(unit, per.units)}</span></h3>
            <CalcField label="Total DNA" unit="ng" value={per.totalDna_ng} decimals={3} />
            <CalcField label="PEI" unit="µl" value={per.pei_ul} />
            <CalcField label="OptiMEM for DNA" unit="µl" value={per.optimemForDna_ul} />
            <CalcField label="OptiMEM for PEI" unit="µl" value={per.optimemForPei_ul} />
            <CalcField label="DMEM" unit="µl" value={per.dmem_ul} />
            <CalcField label="Cells" unit="k cells" value={per.cells_k} decimals={2} hint={`= ${round(per.cells_k / 1000, 4)} M`} />
          </div>
        </div>
        <Legend />
      </Panel>

      <Panel title="DNA stock inventory">
        <table>
          <thead>
            <tr>
              <th className="no-print" style={{ width: 46 }} />
              <th style={{ width: 110 }}>ID</th>
              <th>DNA name</th>
              <th className="num">Stock conc. (ng/µl)</th>
              <th>Notes</th>
              <th style={{ width: 60 }}>Filler</th>
              <th className="no-print" style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {dnaStocks.map((s, i) => (
              <tr
                key={s.id}
                className={dropIndex === i && dragIndex !== i ? 'drop-target' : ''}
                onDragOver={(e) => { e.preventDefault(); setDropIndex(i); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) moveStock(dragIndex, i);
                  setDragIndex(null);
                  setDropIndex(null);
                }}
              >
                <td
                  className="drag-cell no-print"
                  draggable
                  title="Drag to reorder — the condition rows follow"
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                >
                  <span className="grip">⠿</span>
                  <span className="rank">{i + 1}</span>
                </td>
                <td className="input">
                  <input style={{ textAlign: 'left' }} value={s.plasmidId} placeholder="ID" onChange={(e) => setStocks(dnaStocks.map((x, j) => (j === i ? { ...x, plasmidId: e.target.value } : x)))} />
                </td>
                <td className="input">
                  <input style={{ textAlign: 'left' }} value={s.name} onChange={(e) => setStocks(dnaStocks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </td>
                <td className="input">
                  <input
                    type="number"
                    value={s.stockConc_ng_per_ul ?? ''}
                    placeholder="unknown"
                    onChange={(e) =>
                      setStocks(dnaStocks.map((x, j) => (j === i ? { ...x, stockConc_ng_per_ul: e.target.value === '' ? null : Number(e.target.value) } : x)))
                    }
                  />
                </td>
                <td className="input">
                  <input style={{ textAlign: 'left' }} value={s.notes} onChange={(e) => setStocks(dnaStocks.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="radio"
                    name="filler"
                    checked={s.isFiller}
                    onChange={() => setStocks(dnaStocks.map((x, j) => ({ ...x, isFiller: j === i })))}
                  />
                </td>
                <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small" disabled={i === 0} title="Move up" onClick={() => moveStock(i, i - 1)}>↑</button>{' '}
                  <button className="btn small" disabled={i === dnaStocks.length - 1} title="Move down" onClick={() => moveStock(i, i + 1)}>↓</button>{' '}
                  <ConfirmButton onConfirm={() => setStocks(dnaStocks.filter((_, j) => j !== i))} title="Remove this DNA stock">✕</ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint no-print">
          Drag a row by its handle (or use ↑ ↓) to reorder — the condition blocks below follow the
          same order. The filler DNA (usually empty vector) tops every condition up to 100 %. Leave
          a stock concentration blank if you don't know it — volumes then show “—” instead of a
          wrong number.
        </p>
        <button className="btn no-print" onClick={() => setStocks([...dnaStocks, { id: uid('dna'), plasmidId: '', name: '', stockConc_ng_per_ul: null, notes: '', isFiller: false }])}>
          + Add DNA stock
        </button>
      </Panel>

      <Panel title="PEI master mix & cell suspension">
        <div className="grid-2">
          <div>
            <h3>PEI master mix</h3>
            <div className="field">
              <label>Conditions to prepare</label>
              <output className="calc">{gridResult.activeCount}</output>
              <span className="unit">blocks in use</span>
            </div>
            <div className="field">
              <label>{unit === 'dish' ? 'Dishes' : 'Wells'} in total</label>
              <output className="calc">{mix.totalUnits}</output>
              <span className="unit">{unitLabel(unit)}</span>
            </div>
            <div className="pipette-box">
              <CalcField label="Total PEI" unit="µl" value={mix.totalPei_ul} strong />
              <CalcField label="Total OptiMEM for PEI" unit="µl" value={mix.totalOptimemForPei_ul} strong />
            </div>
            <p className="hint">
              Pipette these two into one tube — {fmtUl(mix.totalPei_ul + mix.totalOptimemForPei_ul)} µl
              total: {unitLabel(unit, mix.totalUnits)} plus {fmtUl(recipe.mixExtra_ul)} µl extra.
              Each DNA tube then gets the PEI mix shown in its block below. The OptiMEM is rounded
              up to whole µl — it is the diluent, so the PEI:DNA ratio is untouched.
            </p>
            <CalcField label={`PEI per ${unit}`} unit="µl" value={recipe.pei_ul} />
            <CalcField label={`OptiMEM for PEI per ${unit}`} unit="µl" value={recipe.optimemForPei_ul} />
          </div>
          <div>
            <h3>Cell suspension <span className="sub">+{fmtUl(recipe.cellExtra_ul)} µl extra</span></h3>
            <div className="pipette-box">
              <CalcField label="DMEM total" unit="µl" value={mix.dmemTotal_ul} strong />
              <CalcField label="Total cells needed" unit="k cells" value={mix.totalCells_k} decimals={1} strong hint={`= ${round(mix.totalCells_k / 1000, 4)} M`} />
            </div>
            <CalcField label={`Suspension per ${unit}`} unit="µl" value={recipe.medium_ul} />
            <CalcField label={`Cells per ${unit}`} unit="k cells" value={recipe.cells_k} decimals={1} />
          </div>
        </div>
      </Panel>

      <Panel
        title="DNA mixes — experiment grid"
        actions={
          <div className="no-print" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: '#667085' }}>OptiMEM per DNA tube:</span>
            <Segmented
              value={p.optimemMode}
              options={[
                { value: 'fixed', label: 'Fixed volume added' },
                { value: 'final-volume', label: 'Target final volume' },
              ]}
              onChange={(v) => setParam('optimemMode', v)}
            />
          </div>
        }
      >
        <p className="hint no-print" style={{ margin: '0 0 10px' }}>
          {p.optimemMode === 'fixed' ? (
            <>
              <strong>Fixed volume:</strong> each DNA tube gets the full {fmtUl(per.optimemForDna_ul)} µl
              of OptiMEM, so the tube ends up slightly larger once the DNA is added — this is what the
              spreadsheet did.
            </>
          ) : (
            <>
              <strong>Target final volume:</strong> {fmtUl(per.optimemForDna_ul)} µl is the total each
              DNA tube should reach, so the OptiMEM added is that minus the DNA volume already in it.
            </>
          )}{' '}
          Columns are Dim A, row groups are Dim B. A block counts as a condition as soon as a % is
          typed in it; the button in its header switches it between <em>Use</em> (fills every
          non-filler DNA with 0 %, so {dnaStocks.find((s) => s.isFiller)?.name ?? 'the filler'} tops up
          to 100 % — an empty-vector control) and <em>Clear</em>. Delete a whole column or row group
          with the ✕ next to its label; the ✕ asks once before it removes anything.
        </p>
        <p className="hint no-print" style={{ marginBottom: 10 }}>
          Columns are Dim A, row groups are Dim B. A block only counts as a condition once you type
          a % in it — press <em>Use</em> to turn an unused block into a filler-only control
          (100 % {dnaStocks.find((s) => s.isFiller)?.name ?? 'filler'}), or <em>Clear</em> to drop it
          again. That's how you get a non-rectangular design: e.g. a 2 × 2 receptor × arrestin grid
          plus one extra block used as the empty-vector control = 5 conditions.
        </p>

        <div className="grid-scroll">
        <div className="grid-inner">
        <div className="col-head no-print" style={{ gridTemplateColumns: colTemplate }}>
          {grid.colLabels.map((label, col) => (
            <div className="col-cell" key={col}>
              <input
                value={label}
                placeholder={`Column ${col + 1} label`}
                onChange={(e) => setGrid({ ...grid, colLabels: grid.colLabels.map((l, i) => (i === col ? e.target.value : l)) })}
              />
              <ConfirmButton
                title={`Delete column ${col + 1} and its ${grid.rowGroups} block(s)`}
                disabled={grid.cols <= 1}
                onConfirm={() => setGrid(removeColumn(grid, dnaStocks, col))}
              >✕</ConfirmButton>
            </div>
          ))}
        </div>

        {grid.conditions.map((row, rg) => (
          <div key={rg} style={{ marginBottom: 18 }}>
            <div className="rowgroup-head">
              <span className="tag">Row group {rg + 1}</span>
              <input
                value={grid.rowGroupLabels[rg] ?? ''}
                placeholder={`Row group ${rg + 1} label`}
                onChange={(e) => setGrid({ ...grid, rowGroupLabels: grid.rowGroupLabels.map((l, i) => (i === rg ? e.target.value : l)) })}
              />
              <ConfirmButton
                className="btn small no-print"
                title={`Delete row group ${rg + 1} and its ${grid.cols} block(s)`}
                disabled={grid.rowGroups <= 1}
                onConfirm={() => setGrid(removeRowGroup(grid, dnaStocks, rg))}
              >✕</ConfirmButton>
            </div>
            <div className="cond-grid" style={{ gridTemplateColumns: colTemplate }}>
              {row.map((cond) => {
                const res = gridResult.conditions.find((c) => c.conditionId === cond.id)!;
                return (
                  <div key={cond.id} className={`cond-card${res.isEmpty ? ' empty' : ''}`}>
                    <header>
                      <span className="code">{cond.code}</span>
                      <input
                        value={cond.label}
                        placeholder="label"
                        onChange={(e) => setGrid(updateCondition(grid, cond.id, (c) => ({ ...c, label: e.target.value })))}
                      />
                      <button
                        className="btn small card-btn no-print"
                        title={res.isEmpty ? 'Use this block as a filler-only control' : 'Clear this block'}
                        onClick={() =>
                          setGrid(updateCondition(grid, cond.id, (c) => (res.isEmpty ? enableCondition(c, dnaStocks) : clearCondition(c))))
                        }
                      >
                        {res.isEmpty ? 'Use' : 'Clear'}
                      </button>
                    </header>
                    <div className={`cond-units${res.unitsOverridden ? ' own' : ''}`}>
                      <label htmlFor={`units-${cond.id}`}>{unit === 'dish' ? 'Dishes' : 'Wells'}</label>
                      <input
                        id={`units-${cond.id}`}
                        type="number"
                        min={1}
                        step={1}
                        value={(unit === 'dish' ? cond.dishes : cond.wells) ?? ''}
                        placeholder={String(recipe.defaultUnits)}
                        onChange={(e) => setUnits(cond.id, e.target.value === '' ? null : Number(e.target.value))}
                      />
                      <span>{res.unitsOverridden ? `own count (default ${recipe.defaultUnits})` : 'default'}</span>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>DNA</th>
                          <th className="num">%</th>
                          <th className="num">ng</th>
                          <th className="num">µl</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.rows.map((r) => (
                          <tr key={r.dnaStockId}>
                            <td>{r.name}{r.isFiller ? ' (filler)' : ''}</td>
                            {r.isFiller ? (
                              <td className="calc num">{round(r.pct, 3)}</td>
                            ) : (
                              <td className="input">
                                <input
                                  type="number"
                                  step="any"
                                  value={cond.entries.find((e) => e.dnaStockId === r.dnaStockId)?.pct ?? ''}
                                  onChange={(e) => setPct(cond.id, r.dnaStockId, e.target.value === '' ? null : Number(e.target.value))}
                                />
                              </td>
                            )}
                            <td className="calc num">{round(r.ng, 3)}</td>
                            <td className="calc num">{fmtUl(r.ul)}</td>
                          </tr>
                        ))}
                        <tr className="total">
                          <td>TOTAL</td>
                          <td className="num">{round(res.totalPct, 3)}</td>
                          <td className="num">{round(res.totalNg, 2)}</td>
                          <td className="num">{fmtUl(res.totalUl)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3}>+ OptiMEM</td>
                          <td className="calc num">{fmtUl(res.optimemForDna_ul)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className={res.isEmpty ? '' : res.pctOk ? 'ok' : 'bad'}>
                            {res.isEmpty ? '(unused)' : res.pctOk ? '✓ OK · tube total' : '⚠ ≠ 100 % · tube total'}
                          </td>
                          <td className="calc num">{fmtUl(res.tubeTotal_ul)}</td>
                        </tr>
                        {!res.isEmpty && (
                          <>
                            <tr>
                              <td colSpan={3}>+ PEI mix (from master mix)</td>
                              <td className="calc num">{fmtUl(res.peiMix_ul)}</td>
                            </tr>
                            <tr>
                              <td colSpan={3}>Cell suspension · {round(res.cells_k / 1000, 3)} M cells</td>
                              <td className="calc num">{fmtUl(res.cellSuspension_ul)}</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        </div>
        </div>

        <div className="no-print" style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setGrid(addColumn(grid, dnaStocks))}>+ Add column</button>
          <button className="btn" onClick={() => setGrid(addRowGroup(grid, dnaStocks))}>+ Add row group</button>
        </div>

        {fillerId === null && <div className="msg warn" style={{ marginTop: 10 }}>No filler DNA selected — mark one stock as filler so conditions can top up to 100 %.</div>}
      </Panel>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button className="btn primary" onClick={() => exportTransfectionXlsx(project, per, mix, gridResult.conditions)}>
          Export bench sheet (Excel)
        </button>
        <button className="btn" onClick={() => window.print()}>Print bench sheet</button>
      </div>
    </>
  );
}
