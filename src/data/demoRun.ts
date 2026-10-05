import type { WorkerId } from '../types/trading';

/**
 * The showcased demo run: 23 trading days, every day green, +$72,074 total.
 *
 * Day targets are shaped so the vault passes the milestones seen in the
 * reference recording (+$4,037 → +$7,407 → +$8,555 → +$16,017 → +$47,584 →
 * +$64,659 → +$67,117 → +$72,074) and the last third of the run is noticeably
 * stronger than the first third.
 */

export const RUN_SEED = 0x51a7c0de;

/** First session of the run (Fri Sep 4, 2026). Labor Day (Sep 7) is skipped. */
export const RUN_START = '2026-09-04';
export const MARKET_HOLIDAYS = new Set(['2026-09-07']);
export const TRADING_DAY_COUNT = 23;

/** Session length in minutes (9:30 → 16:00 ET). */
export const SESSION_MINUTES = 390;

export const DAY_PNL_TARGETS: readonly number[] = [
  2113, // Fri 9/4
  1924, // Tue 9/8   → 4,037
  1571, // Wed 9/9
  1799, // Thu 9/10  → 7,407
  1148, // Fri 9/11  → 8,555
  3285, // Mon 9/14
  4177, // Tue 9/15  → 16,017
  4536, // Wed 9/16
  4222, // Thu 9/17
  1864, // Fri 9/18
  2171, // Mon 9/21
  2644, // Tue 9/22
  3108, // Wed 9/23
  2317, // Thu 9/24
  2695, // Fri 9/25
  8010, // Mon 9/28  → 47,584
  10930, // Tue 9/29 — best day
  2483, // Wed 9/30
  3662, // Thu 10/1  → 64,659
  2458, // Fri 10/2  → 67,117
  1736, // Mon 10/5
  1342, // Tue 10/6
  1879, // Wed 10/7  → 72,074
];

export const WORKER_PNL_TARGETS: Readonly<Record<WorkerId, number>> = {
  'qqq-og': 22297,
  spy: 20939,
  'qqq-trend': 19019,
  qqq: 5775,
  iwm: 4044,
};

export const RUN_TOTAL_TARGET = 72074;

/** IWM joins the shift later in the run (it sits at +$0 early on). */
export const WORKER_FIRST_TRADING_DAY: Readonly<Record<WorkerId, number>> = {
  'qqq-og': 0,
  'qqq-trend': 0,
  qqq: 2,
  spy: 0,
  iwm: 10,
};

/** Relative weighting of each worker over time (shapes who earns when). */
export function workerWeight(workerId: WorkerId, dayIndex: number): number {
  const t = dayIndex / (TRADING_DAY_COUNT - 1);
  switch (workerId) {
    case 'qqq-og':
      return 1.35 - 0.35 * t;
    case 'qqq-trend':
      return 0.8 + 0.5 * t;
    case 'qqq':
      return 0.35 + 0.2 * Math.sin(t * Math.PI);
    case 'spy':
      return 0.7 + 0.6 * t;
    case 'iwm':
      return 0.45;
  }
}

/** Typical P&L of a single winning trade per worker (drives trade count). */
export const AVG_TRADE_PNL: Readonly<Record<WorkerId, number>> = {
  'qqq-og': 150,
  'qqq-trend': 360,
  qqq: 260,
  spy: 400,
  iwm: 300,
};

export const MAX_TRADES_PER_DAY: Readonly<Record<WorkerId, number>> = {
  'qqq-og': 9,
  'qqq-trend': 6,
  qqq: 4,
  spy: 6,
  iwm: 4,
};

/** Holding time range in minutes per worker. */
export const HOLD_MINUTES: Readonly<Record<WorkerId, [number, number]>> = {
  'qqq-og': [4, 12],
  'qqq-trend': [12, 34],
  qqq: [8, 26],
  spy: [10, 30],
  iwm: [9, 24],
};

/** Day a worker clocks in (before this it is OFF DUTY). */
export const WORKER_ON_SHIFT_DAY: Readonly<Record<WorkerId, number>> = {
  'qqq-og': 0,
  'qqq-trend': 0,
  qqq: 0,
  spy: 0,
  iwm: 6,
};

/** Contracts per trade range. */
export const CONTRACT_RANGE: Readonly<Record<WorkerId, [number, number]>> = {
  'qqq-og': [5, 8],
  'qqq-trend': [5, 10],
  qqq: [6, 9],
  spy: [6, 12],
  iwm: [8, 15],
};

/** Minutes a setup takes to charge before firing. */
export const CHARGE_MINUTES: Readonly<Record<WorkerId, [number, number]>> = {
  'qqq-og': [7, 13],
  'qqq-trend': [10, 20],
  qqq: [10, 18],
  spy: [9, 19],
  iwm: [9, 17],
};

/** Probability of a false charge (fizzle) in a long idle gap. */
export const FIZZLE_CHANCE: Readonly<Record<WorkerId, number>> = {
  'qqq-og': 0.3,
  'qqq-trend': 0.45,
  qqq: 0.55,
  spy: 0.4,
  iwm: 0.6,
};
