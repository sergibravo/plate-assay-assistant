import { describe, expect, it } from 'vitest';
import { inkOn, paletteColour, PALETTE, shade, tint, toXlsx } from '../palette';

describe('one palette everywhere', () => {
  it('assigns by index and wraps round', () => {
    expect(paletteColour(0)).toBe(PALETTE[0]);
    expect(paletteColour(PALETTE.length)).toBe(PALETTE[0]);
    expect(paletteColour(-1)).toBe(PALETTE[PALETTE.length - 1]);
  });

  it('a series shades from pale to full strength', () => {
    const base = '#2563eb';
    const pale = shade(base, 0, 5);
    const full = shade(base, 4, 5);
    expect(full.toLowerCase()).toBe(base);
    expect(pale).not.toBe(base);
    // the palest step is still visibly coloured, not white
    expect(pale.toLowerCase()).not.toBe('#ffffff');
  });

  it('a single step keeps the base colour', () => {
    expect(shade('#047857', 0, 1)).toBe('#047857');
  });

  it('picks readable text for a background', () => {
    expect(inkOn('#ffffff')).toBe('#16181d');
    expect(inkOn('#2563eb')).toBe('#ffffff');
    expect(inkOn(tint('#2563eb'))).toBe('#16181d'); // a tint is pale, so dark text
  });

  it('hands Excel the format it wants', () => {
    expect(toXlsx('#2563eb')).toBe('2563EB');
  });
});
