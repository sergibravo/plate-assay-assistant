/**
 * One palette for the whole app, so a compound is the same colour wherever it appears —
 * its block in module 3, its tube table, its wells on the plate, and both bench sheets.
 * A colour that means one thing on screen and another on paper is worse than no colour.
 */

/** Base colours, in assignment order. Chosen to stay distinguishable when printed. */
export const PALETTE = [
  '#2563eb', // blue
  '#047857', // green
  '#b45309', // amber
  '#7c3aed', // violet
  '#be185d', // pink
  '#0e7490', // teal
  '#4d7c0f', // olive
  '#9f1239', // crimson
];

/** Neutral, for buffer channels and anything without a compound behind it. */
export const NEUTRAL = '#667085';

export function paletteColour(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * A dilution series reads as a gradient: palest at the most dilute, full strength at the top.
 * `rank` is 0 for the most dilute step and `count - 1` for the most concentrated.
 */
export function shade(base: string, rank: number, count: number): string {
  if (count <= 1) return base;
  const [r, g, b] = hexToRgb(base);
  // Mix towards white; the most dilute keeps a fifth of the colour so it is still legible.
  const strength = 0.2 + 0.8 * (rank / (count - 1));
  return rgbToHex(255 - (255 - r) * strength, 255 - (255 - g) * strength, 255 - (255 - b) * strength);
}

/** How strongly a well is filled with its treatment's colour, on screen and in Excel alike. */
export const WELL_TINT = 0.36;

/** A background tint of a colour, for filling a cell without drowning the text on it. */
export function tint(base: string, amount = 0.18): string {
  const [r, g, b] = hexToRgb(base);
  return rgbToHex(255 - (255 - r) * amount, 255 - (255 - g) * amount, 255 - (255 - b) * amount);
}

/** Black or white text, whichever stays readable on the given background. */
export function inkOn(background: string): string {
  const [r, g, b] = hexToRgb(background);
  // Rec. 601 luma is close enough for picking text colour.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#16181d' : '#ffffff';
}

/** Excel wants RRGGBB with no hash. */
export function toXlsx(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

/**
 * A well holding two treatments is split diagonally rather than showing one colour and a
 * count: both are visible at once, and which is which is read off the legend.
 */
export function diagonalSplit(colours: string[]): string {
  if (colours.length === 0) return 'transparent';
  if (colours.length === 1) return colours[0];
  const step = 100 / colours.length;
  const stops = colours
    .map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`)
    .join(', ');
  return `linear-gradient(135deg, ${stops})`;
}
