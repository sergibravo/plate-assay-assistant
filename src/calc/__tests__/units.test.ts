import { describe, expect, it } from 'vitest';
import { ceilingTo1, fmtUl, logMToUM, round, roundUl, uMToLogM } from '../units';

describe('volumes are shown to what a pipette can deliver', () => {
  it('two decimals at 10 µl and below', () => {
    expect(roundUl(0.4)).toBe(0.4);
    expect(roundUl(0.4444)).toBe(0.44);
    expect(roundUl(7.336666)).toBe(7.34);
    expect(roundUl(10)).toBe(10);
    expect(roundUl(9.999)).toBe(10);
  });

  it('one decimal above 10 µl', () => {
    expect(roundUl(10.04)).toBe(10);
    expect(roundUl(47.283)).toBe(47.3);
    expect(roundUl(199.63)).toBe(199.6);
    expect(roundUl(12350.04)).toBe(12350);
  });

  it('formats the same way, and says "—" when there is nothing to show', () => {
    expect(fmtUl(0.4444)).toBe('0.44');
    expect(fmtUl(199.63)).toBe('199.6');
    expect(fmtUl(null)).toBe('—');
    expect(fmtUl(Number.NaN)).toBe('—');
  });

  it('is display only — nothing it touches feeds a calculation', () => {
    // the raw value keeps every digit; only its rendering is trimmed
    const raw = 199.6333333;
    expect(fmtUl(raw)).toBe('199.6');
    expect(raw).toBe(199.6333333);
  });
});

describe('the other helpers still behave', () => {
  it('CEILING snaps float noise before rounding up', () => {
    expect(ceilingTo1(200.00000000000003)).toBe(200);
    expect(ceilingTo1(200.4)).toBe(201);
  });

  it('logM converts both ways', () => {
    expect(logMToUM(-6)).toBeCloseTo(1, 12);
    expect(uMToLogM(1)).toBeCloseTo(-6, 12);
  });

  it('round keeps its explicit precision', () => {
    expect(round(1.23456, 3)).toBe(1.235);
  });
});
