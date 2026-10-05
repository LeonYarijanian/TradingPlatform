import type { Rng } from './rng';

const MINUS = '−';

/** "+$72,074", "−$84", "$0" */
export function formatMoney(value: number, opts: { sign?: boolean; cents?: boolean } = {}): string {
  const { sign = true, cents = false } = opts;
  const rounded = cents ? Math.round(value * 100) / 100 : Math.round(value);
  const abs = Math.abs(rounded);
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  if (rounded < 0) return `${MINUS}$${body}`;
  if (sign && rounded > 0) return `+$${body}`;
  return `$${body}`;
}

/** "+4.2k", "+930", "−1.1k" */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const s = value < 0 ? MINUS : '+';
  if (abs >= 1000) return `${s}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${s}${Math.round(abs)}`;
}

export function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function formatPercent(value: number, digits = 2): string {
  const s = value < 0 ? MINUS : '+';
  return `${s}${Math.abs(value).toFixed(digits)}%`;
}

/**
 * Builds a non-negative integer matrix whose rows sum exactly to `rowTargets`
 * and whose columns sum exactly to `colTargets`, starting from `seed` weights
 * (iterative proportional fitting + controlled integer rounding).
 *
 * Cells with a zero seed weight stay zero.
 */
export function balanceMatrix(seed: number[][], rowTargets: readonly number[], colTargets: readonly number[]): number[][] {
  const rows = rowTargets.length;
  const cols = colTargets.length;
  const rowSum = rowTargets.reduce((a, b) => a + b, 0);
  const colSum = colTargets.reduce((a, b) => a + b, 0);
  if (rowSum !== colSum) throw new Error(`balanceMatrix: row total ${rowSum} != column total ${colSum}`);

  const m = seed.map((r) => r.slice());
  for (let iter = 0; iter < 500; iter++) {
    for (let i = 0; i < rows; i++) {
      const s = m[i].reduce((a, b) => a + b, 0);
      if (s > 0) for (let j = 0; j < cols; j++) m[i][j] *= rowTargets[i] / s;
    }
    let maxErr = 0;
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let i = 0; i < rows; i++) s += m[i][j];
      if (s > 0) for (let i = 0; i < rows; i++) m[i][j] *= colTargets[j] / s;
      maxErr = Math.max(maxErr, Math.abs(s - colTargets[j]));
    }
    if (maxErr < 1e-6) break;
  }

  // Round each row so the row sum is exact (largest remainder method).
  const out = m.map((row, i) => {
    const floors = row.map((v) => Math.floor(v));
    let deficit = rowTargets[i] - floors.reduce((a, b) => a + b, 0);
    const order = row
      .map((v, j) => ({ j, frac: v - Math.floor(v), live: v > 0 }))
      .filter((o) => o.live)
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; deficit > 0 && order.length > 0; k++, deficit--) floors[order[k % order.length].j] += 1;
    return floors;
  });

  // Fix column residuals by moving single dollars between cells within a row
  // (keeps row sums intact).
  for (let guard = 0; guard < 100000; guard++) {
    const colResidual = colTargets.map((t, j) => t - out.reduce((a, r) => a + r[j], 0));
    const plus = colResidual.findIndex((r) => r > 0);
    const minus = colResidual.findIndex((r) => r < 0);
    if (plus === -1 || minus === -1) break;
    // Row where both columns are live and the donor cell has the most room.
    let best = -1;
    let bestVal = 0;
    for (let i = 0; i < rows; i++) {
      if (seed[i][plus] > 0 && seed[i][minus] > 0 && out[i][minus] > bestVal) {
        best = i;
        bestVal = out[i][minus];
      }
    }
    if (best === -1) throw new Error('balanceMatrix: unable to balance columns');
    const amount = Math.min(colResidual[plus], -colResidual[minus], out[best][minus]);
    out[best][plus] += amount;
    out[best][minus] -= amount;
  }
  return out;
}

/**
 * Splits `total` into `n` integer parts (each ≥ `minPart` when possible),
 * with random variation.
 */
export function splitAmount(total: number, n: number, rng: Rng, minPart = 1): number[] {
  if (n <= 1) return [total];
  const weights = Array.from({ length: n }, () => 0.45 + rng() * 1.1);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const floor = Math.min(minPart, Math.floor(total / n));
  const spare = total - floor * n;
  const parts = weights.map((w) => floor + Math.floor((spare * w) / wSum));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % n, rest--) parts[i] += 1;
  return parts;
}

/** Ease helpers shared by count-up animations. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
