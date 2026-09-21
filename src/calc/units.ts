/**
 * Numeric helpers. Compute at full precision; round only for display.
 */

/**
 * Excel `CEILING(x, 1)` for non-negative x — round up to the next whole µl.
 *
 * Deliberate deviation: values within 1e-9 of a whole number are treated as that
 * whole number before rounding up. Excel would let binary float noise
 * (200.00000000000003) push a 200 µl tube to 201 µl; we do not.
 */
export function ceilingTo1(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const snapped = Math.round(x * 1e9) / 1e9;
  return Math.ceil(snapped);
}

/** Round for display only. */
export function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

/** Display a volume in µl: 2 dp, trailing zeros trimmed, "—" when unknown. */
export function fmtVol(x: number | null | undefined, decimals = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return String(round(x, decimals));
}

/** logM → µM. `10^logM` is molar; ×1e6 gives µM. */
export function logMToUM(logM: number): number {
  return 10 ** logM * 1e6;
}

/** µM → logM (inverse of the above), for round-tripping user entry. */
export function uMToLogM(uM: number): number {
  return Math.log10(uM / 1e6);
}

/** Volumes below this are not reliably pipettable by hand. */
export const MIN_PIPETTE_UL = 0.5;

/**
 * In-well DMSO that most cells tolerate. Above this the app says so: it is not a hard limit
 * — some assays run higher deliberately — but at that point it is usually a sign that a
 * stock is too dilute for the spike being asked of it.
 */
export const DMSO_IN_WELL_CONCERN = 0.01; // 1 %

/**
 * A relative deviation smaller than this is not worth correcting: it is well inside the
 * error of the pipetting that a correction would itself introduce. Used for the carrier
 * (BSA / DMSO) that stocks displace when a premix is made from ready-made assay buffer.
 */
export const NEGLIGIBLE_RELATIVE = 0.02;
