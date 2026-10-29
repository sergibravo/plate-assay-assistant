import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Warning } from '../calc/types';
import { fmtUl, fmtVol } from '../calc/units';

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Two-step delete. Deliberately not `window.confirm`: a native modal freezes the
 * embedded preview browser, and an in-page confirm is easier to back out of anyway.
 * Click once to arm, click again within 6 s to fire; it disarms itself.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Delete?',
  title,
  disabled,
  className = 'btn small',
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      className={`${className}${armed ? ' armed' : ''}`}
      title={armed ? 'Click again to confirm' : title}
      disabled={disabled}
      onClick={() => {
        window.clearTimeout(timer.current);
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 6000);
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

/** Two-state switch, e.g. how the OptiMEM volume is derived. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented no-print" role="group">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Yellow = the user types here. Units are never optional. */
export function NumField({
  label,
  unit,
  value,
  onChange,
  step = 'any',
  min,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  step?: string | number;
  min?: number;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      <span className="unit">{unit}</span>
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <span className="unit" />
    </div>
  );
}

/** Blue = computed by the app. Read-only by construction. */
export function CalcField({
  label,
  unit,
  value,
  decimals,
  hint,
  strong,
}: {
  label: string;
  unit: string;
  value: number | null;
  decimals?: number;
  /** Small muted note after the unit, e.g. an equivalent in other units. */
  hint?: string;
  /** Emphasise a value the user actually pipettes. */
  strong?: boolean;
}) {
  return (
    <div className={`field${strong ? ' strong' : ''}`}>
      <label>{label}</label>
      <output className="calc">
        {decimals === undefined && unit.startsWith('µl') ? fmtUl(value) : fmtVol(value, decimals ?? 2)}
      </output>
      <span className="unit">
        {unit}
        {hint ? <em className="sub"> {hint}</em> : null}
      </span>
    </div>
  );
}

export function Warnings({ items }: { items: Warning[] }) {
  if (items.length === 0) return null;
  // Collapse identical messages raised by several conditions at once.
  const seen = new Map<string, Warning & { count: number }>();
  for (const w of items) {
    const key = `${w.level}|${w.code}|${w.message}`;
    const prev = seen.get(key);
    if (prev) prev.count += 1;
    else seen.set(key, { ...w, count: 1 });
  }
  return (
    <div className="no-print">
      {[...seen.values()].map((w, i) => (
        <div key={i} className={`msg ${w.level}`}>
          {w.scope ? <strong>{w.scope}: </strong> : null}
          {w.message}
          {w.count > 1 ? ` (×${w.count})` : ''}
        </div>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend no-print">
      <span><span className="swatch input" />user input</span>
      <span><span className="swatch calc" />auto-calculated</span>
    </div>
  );
}
