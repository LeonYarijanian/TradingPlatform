import {
  AVG_TRADE_PNL,
  CHARGE_MINUTES,
  CONTRACT_RANGE,
  DAY_PNL_TARGETS,
  FIZZLE_CHANCE,
  HOLD_MINUTES,
  MAX_TRADES_PER_DAY,
  RUN_SEED,
  RUN_START,
  SESSION_MINUTES,
  TRADING_DAY_COUNT,
  WORKER_FIRST_TRADING_DAY,
  WORKER_ON_SHIFT_DAY,
  WORKER_PNL_TARGETS,
  workerWeight,
} from '../data/demoRun';
import { TICKER_PROFILES } from '../data/marketData';
import { WORKERS } from '../data/workers';
import type { FizzleEvent, OptionDirection, TradeEvent, WorkerId } from '../types/trading';
import { buildTradingCalendar, type CalendarDay } from './calendar';
import { generateMarket, type MarketSeries } from './marketGenerator';
import { balanceMatrix, splitAmount } from './pnl';
import { createRng, hashSeed, int, range, type Rng } from './rng';

export type SegmentKind = 'charge' | 'fizzle' | 'position' | 'cooldown';

/** A span of a worker's timeline in global minutes. */
export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
  direction: OptionDirection;
  /** Fizzle: time of peak charge. */
  peak?: number;
  /** Fizzle: peak charge 0..100. */
  peakCharge?: number;
  /** ATR distance when the charge starts. */
  atrStart: number;
  /** Per-segment wobble seed. */
  seed: number;
  tradeId?: string;
}

export type QueueKind = 'session-close' | 'session-open' | 'close' | 'fizzle-end' | 'arm' | 'fire' | 'trail';

const QUEUE_PRIORITY: Record<QueueKind, number> = {
  'session-close': 0,
  'session-open': 1,
  close: 2,
  'fizzle-end': 3,
  arm: 4,
  fire: 5,
  trail: 6,
};

export interface QueueItem {
  t: number;
  kind: QueueKind;
  dayIndex: number;
  workerId?: WorkerId;
  trade?: TradeEvent;
  fizzle?: FizzleEvent;
}

export interface DemoSchedule {
  calendar: CalendarDay[];
  market: MarketSeries;
  trades: TradeEvent[];
  fizzles: FizzleEvent[];
  segments: Record<WorkerId, Segment[]>;
  queue: QueueItem[];
  /** Realized P&L matrix [day][worker index in WORKERS order]. */
  cells: number[][];
  onShiftDay: Record<WorkerId, number>;
  totalMinutes: number;
}

export function sortQueue(queue: QueueItem[]): QueueItem[] {
  return queue.sort((a, b) => a.t - b.t || QUEUE_PRIORITY[a.kind] - QUEUE_PRIORITY[b.kind]);
}

export const ARROW: Record<OptionDirection, string> = { CALL: '▲', PUT: '▼' };

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

interface Block {
  pnl: number;
  charge: number;
  hold: number;
  cooldown: number;
}

/** Builds the full deterministic demo run. */
export function buildDemoSchedule(seed: number = RUN_SEED): DemoSchedule {
  const calendar = buildTradingCalendar(RUN_START, TRADING_DAY_COUNT);
  const market = generateMarket(TRADING_DAY_COUNT, seed);
  const rng = createRng(seed);

  // 1. Day × worker realized P&L matrix with exact row/column totals.
  const seedMatrix = DAY_PNL_TARGETS.map((_, d) =>
    WORKERS.map((w) => (d < WORKER_FIRST_TRADING_DAY[w.id] ? 0 : workerWeight(w.id, d) * (0.55 + rng() * 0.9))),
  );
  const cells = balanceMatrix(
    seedMatrix,
    DAY_PNL_TARGETS,
    WORKERS.map((w) => WORKER_PNL_TARGETS[w.id]),
  );

  const trades: TradeEvent[] = [];
  const fizzles: FizzleEvent[] = [];
  const segments = Object.fromEntries(WORKERS.map((w) => [w.id, [] as Segment[]])) as Record<WorkerId, Segment[]>;
  const queue: QueueItem[] = [];

  for (let d = 0; d < TRADING_DAY_COUNT; d++) {
    const dayBase = d * SESSION_MINUTES;
    queue.push({ t: dayBase, kind: 'session-open', dayIndex: d });
    queue.push({ t: dayBase + SESSION_MINUTES, kind: 'session-close', dayIndex: d });

    WORKERS.forEach((worker, k) => {
      if (d < WORKER_ON_SHIFT_DAY[worker.id]) return;
      const wr = createRng(seed ^ hashSeed(`${worker.id}:${d}`));
      const cell = cells[d][k];
      const series = market.tickers[worker.ticker];
      const profile = TICKER_PROFILES[worker.ticker];

      // 2. Split the day's realized P&L into individual trades.
      const pnls: number[] = [];
      if (cell > 0) {
        const n = Math.max(1, Math.min(MAX_TRADES_PER_DAY[worker.id], Math.round((cell / AVG_TRADE_PNL[worker.id]) * (0.8 + wr() * 0.4))));
        let loss = 0;
        if (n >= 2 && cell > 600 && wr() < 0.32) loss = int(wr, 48, Math.min(240, Math.floor(cell * 0.14)));
        const winners = loss > 0 ? n - 1 : n;
        pnls.push(...splitAmount(cell + loss, winners, wr, 25));
        if (loss > 0) pnls.push(-loss);
        shuffle(wr, pnls);
      }

      // 3. Lay the trades out across the session.
      const [cMin, cMax] = CHARGE_MINUTES[worker.id];
      const [hMin, hMax] = HOLD_MINUTES[worker.id];
      const blocks: Block[] = pnls.map((pnl) => ({
        pnl,
        charge: int(wr, cMin, cMax),
        hold: int(wr, hMin, hMax),
        cooldown: int(wr, 3, 7),
      }));
      const open = 10;
      const close = 380;
      const used = blocks.reduce((a, b) => a + b.charge + b.hold + b.cooldown, 0);
      const free = Math.max(0, close - open - used);
      const gaps = blocks.length > 0 ? splitAmount(free, blocks.length + 1, wr, 2) : [free];
      let cursor = open;
      const idleGaps: Array<[number, number]> = [];
      blocks.forEach((b, i) => {
        idleGaps.push([cursor, cursor + gaps[i]]);
        cursor += gaps[i];
        const chargeStart = cursor;
        const entry = chargeStart + b.charge;
        const exit = entry + b.hold;
        cursor = exit + b.cooldown;

        const gEntry = dayBase + entry;
        const gExit = dayBase + exit;
        const move = series.price[gExit] - series.price[gEntry];
        const winner = b.pnl >= 0;
        let direction: OptionDirection = move >= 0 ? 'CALL' : 'PUT';
        if (!winner) direction = direction === 'CALL' ? 'PUT' : 'CALL';
        const contracts = int(wr, CONTRACT_RANGE[worker.id][0], CONTRACT_RANGE[worker.id][1]);
        const entryPrice = Math.round(range(wr, profile.premium[0], profile.premium[1]) * 100) / 100;
        const exitPrice = Math.max(0.05, Math.round((entryPrice + b.pnl / (contracts * 100)) * 100) / 100);
        const underlying = series.price[gEntry];
        const id = `${worker.id}-${d}-${i}`;
        const exitReason: TradeEvent['exitReason'] = winner ? (wr() < 0.62 ? 'trail' : 'target') : wr() < 0.7 ? 'stop' : 'time';
        const trade: TradeEvent = {
          id,
          workerId: worker.id,
          ticker: worker.ticker,
          dayIndex: d,
          chargeStartMinute: chargeStart,
          entryMinute: entry,
          exitMinute: exit,
          direction,
          contracts,
          entryPrice,
          exitPrice,
          underlyingPrice: underlying,
          pnl: b.pnl,
          exitReason,
          description: `FIRE ${ARROW[direction]} ${direction} x${contracts} @ ${entryPrice.toFixed(2)} (${worker.ticker} ${underlying.toFixed(2)})`,
        };
        trades.push(trade);

        const atrStart = range(wr, 3.2, 5.2);
        const segSeed = wr() * 100;
        segments[worker.id].push(
          { kind: 'charge', start: dayBase + chargeStart, end: gEntry, direction, atrStart, seed: segSeed, tradeId: id },
          { kind: 'position', start: gEntry, end: gExit, direction, atrStart, seed: segSeed, tradeId: id },
          { kind: 'cooldown', start: gExit, end: gExit + b.cooldown, direction, atrStart, seed: segSeed, tradeId: id },
        );
        queue.push(
          { t: dayBase + chargeStart, kind: 'arm', dayIndex: d, workerId: worker.id, trade },
          { t: gEntry, kind: 'fire', dayIndex: d, workerId: worker.id, trade },
          { t: gExit, kind: 'close', dayIndex: d, workerId: worker.id, trade },
        );
        if (b.hold >= 8) {
          queue.push({ t: gEntry + Math.round(b.hold * 0.5), kind: 'trail', dayIndex: d, workerId: worker.id, trade });
        }
      });
      idleGaps.push([cursor, close + 4]);

      // 4. False charges (setups that build up and fade without firing).
      for (const [gs, ge] of idleGaps) {
        const len = ge - gs;
        if (len < 22 || wr() > FIZZLE_CHANCE[worker.id] * (blocks.length === 0 ? 1.6 : 1)) continue;
        const flen = int(wr, 12, Math.min(24, len - 6));
        const fs = gs + int(wr, 2, Math.max(2, len - flen - 3));
        const peak = fs + flen * range(wr, 0.55, 0.72);
        const peakCharge = int(wr, 31, 84);
        const gPeak = dayBase + Math.round(peak);
        const later = Math.min(dayBase + SESSION_MINUTES - 1, gPeak + 6);
        const direction: OptionDirection = series.price[later] >= series.price[gPeak] ? 'CALL' : 'PUT';
        const fizzle: FizzleEvent = {
          workerId: worker.id,
          dayIndex: d,
          startMinute: fs,
          peakMinute: peak,
          endMinute: fs + flen,
          peakCharge,
          direction,
        };
        fizzles.push(fizzle);
        segments[worker.id].push({
          kind: 'fizzle',
          start: dayBase + fs,
          end: dayBase + fs + flen,
          peak: dayBase + peak,
          peakCharge,
          direction,
          atrStart: range(wr, 3.4, 5),
          seed: wr() * 100,
        });
        queue.push({ t: dayBase + fs, kind: 'arm', dayIndex: d, workerId: worker.id, fizzle });
        queue.push({ t: dayBase + fs + flen, kind: 'fizzle-end', dayIndex: d, workerId: worker.id, fizzle });
      }
    });
  }

  for (const id of Object.keys(segments) as WorkerId[]) segments[id].sort((a, b) => a.start - b.start);
  trades.sort((a, b) => a.dayIndex - b.dayIndex || a.entryMinute - b.entryMinute);

  return {
    calendar,
    market,
    trades,
    fizzles,
    segments,
    queue: sortQueue(queue),
    cells,
    onShiftDay: { ...WORKER_ON_SHIFT_DAY },
    totalMinutes: market.totalMinutes,
  };
}
