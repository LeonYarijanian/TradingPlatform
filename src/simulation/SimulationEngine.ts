import { SESSION_MINUTES } from '../data/demoRun';
import { TICKERS, TICKER_PROFILES } from '../data/marketData';
import { DEMO_WORKERS as WORKERS, DEMO_WORKER_BY_ID as WORKER_BY_ID } from '../data/workers';
import type {
  BotEvent,
  BotEventSource,
  BotStatusEvent,
  OptionDirection,
  Ticker,
  TradeEvent,
  WorkerId,
  WorkerStatus,
} from '../types/trading';
import { formatMoney } from './pnl';
import { ARROW, buildDemoSchedule, sortQueue, type DemoSchedule, type QueueItem, type Segment } from './eventScheduler';
import { pointAt, priceAt } from './marketGenerator';
import { createRng, int, range } from './rng';

export interface WorkerSnapshot {
  status: WorkerStatus;
  direction: OptionDirection | null;
  charge: number;
  atrAway: number;
}

/** Minutes of the session open spent "scanning" before settling into "watching". */
const SCAN_MINUTES = 8;
/** How long before entry a worker reports READY. */
const READY_LEAD = 1.4;
/** How long the FIRING status is held after entry. */
const FIRING_MINUTES = 1;

/**
 * Deterministic demo trading engine.
 *
 * The engine owns a clock measured in global session minutes (day × 390 +
 * minute). `advance(dt)` moves the clock forward and emits the protocol
 * events (`BotEvent`) that happened in that span, exactly as a live backend
 * would stream them. Nothing in the UI reads the schedule directly.
 */
export class SimulationEngine implements BotEventSource {
  readonly schedule: DemoSchedule;
  private listeners = new Set<(events: BotEvent[]) => void>();
  private time = 0;
  private queueIndex = 0;
  private queue: QueueItem[];
  private segIndex: Record<WorkerId, number>;
  private overrides: Record<WorkerId, Segment[]>;
  private lastStatus: Record<WorkerId, string>;
  private lastBar: Record<Ticker, number>;
  private injectCount = 0;
  private injectRng = createRng(0xfeed);

  constructor(schedule: DemoSchedule = buildDemoSchedule()) {
    this.schedule = schedule;
    this.queue = schedule.queue.slice();
    this.segIndex = this.emptyRecord(() => 0);
    this.overrides = this.emptyRecord(() => [] as Segment[]);
    this.lastStatus = this.emptyRecord(() => '');
    this.lastBar = { QQQ: -1, SPY: -1, IWM: -1 } as Record<Ticker, number>;
  }

  private emptyRecord<T>(make: () => T): Record<WorkerId, T> {
    return Object.fromEntries(WORKERS.map((w) => [w.id, make()])) as Record<WorkerId, T>;
  }

  get totalMinutes(): number {
    return this.schedule.totalMinutes;
  }

  get currentTime(): number {
    return this.time;
  }

  get finished(): boolean {
    return this.time >= this.totalMinutes;
  }

  subscribe(listener: (events: BotEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: BotEvent[]): BotEvent[] {
    if (events.length > 0) for (const l of this.listeners) l(events);
    return events;
  }

  /** Resets to the very start of the run and emits the initial state. */
  reset(): BotEvent[] {
    this.time = 0;
    this.queueIndex = 0;
    this.queue = this.schedule.queue.slice();
    this.segIndex = this.emptyRecord(() => 0);
    this.overrides = this.emptyRecord(() => [] as Segment[]);
    this.lastStatus = this.emptyRecord(() => '');
    this.lastBar = { QQQ: -1, SPY: -1, IWM: -1 } as Record<Ticker, number>;
    this.injectCount = 0;
    this.injectRng = createRng(0xfeed);
    const events: BotEvent[] = [
      {
        type: 'RUN_INIT',
        days: this.schedule.calendar.map((d) => ({ date: d.date, label: d.label })),
      },
    ];
    this.collect(0, events, true);
    return this.emit(events);
  }

  /** Advances the clock by `dt` session minutes and emits what happened. */
  advance(dt: number): BotEvent[] {
    if (dt <= 0 && this.time > 0) return [];
    const to = Math.min(this.totalMinutes, this.time + Math.max(0, dt));
    this.time = to;
    const events: BotEvent[] = [];
    this.collect(to, events, false);
    return this.emit(events);
  }

  /** Jumps to the close of the current session (debug "End Day"). */
  endDay(): BotEvent[] {
    if (this.finished) return [];
    const day = Math.floor(this.time / SESSION_MINUTES);
    const target = (day + 1) * SESSION_MINUTES;
    // Land a hair before the next open so the day is closed but the next one hasn't begun.
    return this.advance(target - this.time);
  }

  /**
   * Debug: force a worker to charge and fire a trade right now.
   * Refused (with a reason) when the worker is off shift, already busy with a
   * scheduled or manual setup, or there isn't time left in the session.
   */
  inject(workerId: WorkerId, direction: OptionDirection): { ok: true } | { ok: false; reason: string } {
    if (this.finished) return { ok: false, reason: 'run finished' };
    const worker = WORKER_BY_ID[workerId];
    const rng = this.injectRng;
    const day = Math.min(this.schedule.calendar.length - 1, Math.floor(this.time / SESSION_MINUTES));
    if (day < this.schedule.onShiftDay[workerId]) return { ok: false, reason: `${worker.displayName} is off duty` };
    const start = this.time;
    const charge = 7;
    const hold = 7;
    const cooldown = 2;
    const entry = start + charge;
    const exit = entry + hold;
    const sessionEnd = Math.min((day + 1) * SESSION_MINUTES - 1, this.totalMinutes - 1);
    if (exit + cooldown > sessionEnd) return { ok: false, reason: 'too close to the close' };
    const busy = (segs: Segment[]) => segs.some((g) => g.start < exit + cooldown && g.end > start);
    if (busy(this.overrides[workerId]) || busy(this.schedule.segments[workerId])) {
      return { ok: false, reason: `${worker.displayName} is busy with a setup` };
    }
    const contracts = int(rng, 5, 9);
    const premium = TICKER_PROFILES[worker.ticker].premium;
    const entryPrice = Math.round(range(rng, premium[0], premium[1]) * 100) / 100;
    const pnl = rng() < 0.85 ? int(rng, 120, 940) : -int(rng, 40, 160);
    const underlying = priceAt(this.schedule.market, worker.ticker, entry);
    const id = `manual-${workerId}-${++this.injectCount}`;
    const trade: TradeEvent = {
      id,
      workerId,
      ticker: worker.ticker,
      dayIndex: day,
      chargeStartMinute: start - day * SESSION_MINUTES,
      entryMinute: entry - day * SESSION_MINUTES,
      exitMinute: exit - day * SESSION_MINUTES,
      direction,
      contracts,
      entryPrice,
      exitPrice: Math.max(0.05, Math.round((entryPrice + pnl / (contracts * 100)) * 100) / 100),
      underlyingPrice: underlying,
      pnl,
      exitReason: pnl >= 0 ? 'trail' : 'stop',
      description: `FIRE ${ARROW[direction]} ${direction} x${contracts} @ ${entryPrice.toFixed(2)} (${worker.ticker} ${underlying.toFixed(2)})`,
    };
    const seed = rng() * 100;
    this.overrides[workerId] = [
      { kind: 'charge', start, end: entry, direction, atrStart: 3.9, seed, tradeId: id },
      { kind: 'position', start: entry, end: exit, direction, atrStart: 3.9, seed, tradeId: id },
      { kind: 'cooldown', start: exit, end: exit + cooldown, direction, atrStart: 3.9, seed, tradeId: id },
    ];
    const items: QueueItem[] = [
      { t: start, kind: 'arm', dayIndex: day, workerId, trade },
      { t: entry, kind: 'fire', dayIndex: day, workerId, trade },
      { t: exit, kind: 'close', dayIndex: day, workerId, trade },
    ];
    const rest = this.queue.slice(this.queueIndex).concat(items);
    this.queue = this.queue.slice(0, this.queueIndex).concat(sortQueue(rest));
    return { ok: true };
  }
  /** Next scheduled (non-manual) fire strictly after `after`. Used by the auto-demo director. */
  findNextFire(after: number, workerFilter?: (id: WorkerId) => boolean): { workerId: WorkerId; time: number } | null {
    for (let i = this.queueIndex; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.kind === 'fire' && q.t > after && q.workerId && (!workerFilter || workerFilter(q.workerId))) {
        return { workerId: q.workerId, time: q.t };
      }
    }
    return null;
  }

  priceAt(ticker: Ticker, t = this.time): number {
    return priceAt(this.schedule.market, ticker, t);
  }

  /** Continuous status of a worker at global time `t`. */
  snapshot(workerId: WorkerId, t = this.time): WorkerSnapshot {
    const worker = WORKER_BY_ID[workerId];
    const day = Math.min(this.schedule.calendar.length - 1, Math.floor(t / SESSION_MINUTES));
    const minute = t - day * SESSION_MINUTES;
    const market = this.schedule.market;
    const idx = Math.max(0, Math.min(market.totalMinutes - 1, Math.floor(t)));
    const series = market.tickers[worker.ticker];
    const idleAtr = Math.min(9.9, 1.6 + Math.abs(series.price[idx] - series.ema50[idx]) / TICKER_PROFILES[worker.ticker].atr);

    if (t >= this.totalMinutes || day < this.schedule.onShiftDay[workerId]) {
      return { status: 'off-duty', direction: null, charge: 0, atrAway: idleAtr };
    }

    const seg = this.activeSegment(workerId, t);
    if (seg) {
      switch (seg.kind) {
        case 'charge': {
          const p = Math.min(1, Math.max(0, (t - seg.start) / Math.max(0.001, seg.end - seg.start)));
          const wobble = 0.05 * Math.sin(p * 11 + seg.seed) * (1 - p);
          let charge = Math.max(1, Math.min(99, 100 * (Math.pow(p, 1.25) + wobble)));
          const ready = seg.end - t <= READY_LEAD;
          if (ready) charge = Math.max(charge, 94 + 5 * (1 - (seg.end - t) / READY_LEAD));
          return {
            status: ready ? 'ready' : 'charging',
            direction: seg.direction,
            charge,
            atrAway: seg.atrStart * (1 - charge / 100),
          };
        }
        case 'fizzle': {
          const peakT = seg.peak ?? seg.end;
          const peakC = seg.peakCharge ?? 50;
          if (t <= peakT) {
            const p = (t - seg.start) / Math.max(0.001, peakT - seg.start);
            const charge = Math.max(1, peakC * Math.pow(p, 1.15) + 3 * Math.sin(p * 9 + seg.seed) * p);
            return { status: 'charging', direction: seg.direction, charge, atrAway: seg.atrStart * (1 - charge / 100) };
          }
          const p = (t - peakT) / Math.max(0.001, seg.end - peakT);
          const charge = Math.max(0, peakC * (1 - p));
          return { status: 'scanning', direction: seg.direction, charge, atrAway: seg.atrStart * (1 - charge / 100) };
        }
        case 'position': {
          const held = t - seg.start;
          const total = seg.end - seg.start;
          const status: WorkerStatus = held < FIRING_MINUTES ? 'firing' : held < total * 0.45 ? 'managing' : 'trailing';
          return { status, direction: seg.direction, charge: 0, atrAway: 0 };
        }
        case 'cooldown':
          return { status: 'cooldown', direction: null, charge: 0, atrAway: idleAtr };
      }
    }
    if (minute < SCAN_MINUTES) return { status: 'scanning', direction: null, charge: 0, atrAway: idleAtr };
    return { status: 'watching', direction: null, charge: 0, atrAway: idleAtr };
  }

  private activeSegment(workerId: WorkerId, t: number): Segment | null {
    for (const o of this.overrides[workerId]) if (t >= o.start && t < o.end) return o;
    const segs = this.schedule.segments[workerId];
    let i = this.segIndex[workerId];
    // The pointer only ever moves forward during normal playback; rewind if asked about the past.
    if (i > 0 && segs[i - 1].end > t) i = 0;
    while (i < segs.length && segs[i].end <= t) i++;
    this.segIndex[workerId] = i;
    if (i < segs.length && segs[i].start <= t) return segs[i];
    return null;
  }

  private collect(to: number, out: BotEvent[], initial: boolean): void {
    const market = this.schedule.market;
    const dayOf = (t: number) => Math.min(this.schedule.calendar.length - 1, Math.floor(t / SESSION_MINUTES));

    // Discrete events, interleaved with closed minute bars in time order.
    const flushBarsUntil = (t: number) => {
      const lastIdx = Math.min(market.totalMinutes - 1, Math.floor(t));
      for (const ticker of TICKERS) {
        for (let i = this.lastBar[ticker] + 1; i <= lastIdx; i++) {
          out.push({ type: 'MARKET_BAR', ticker, point: pointAt(market, ticker, i) });
        }
        this.lastBar[ticker] = Math.max(this.lastBar[ticker], lastIdx);
      }
    };

    while (this.queueIndex < this.queue.length && this.queue[this.queueIndex].t <= to) {
      const item = this.queue[this.queueIndex];
      // A new session opens before its first bar so the day's open is bar 0.
      flushBarsUntil(item.kind === 'session-open' ? item.t - 0.5 : item.t);
      this.queueIndex++;
      this.toEvents(item, out);
    }
    flushBarsUntil(to);

    const day = dayOf(to);
    const finished = to >= this.totalMinutes;
    out.push({ type: 'CLOCK', dayIndex: day, minute: finished ? SESSION_MINUTES : to - day * SESSION_MINUTES, finished });

    for (const ticker of TICKERS) {
      out.push({
        type: 'MARKET_TICK',
        ticker,
        timestamp: to,
        price: finished ? market.tickers[ticker].dayClose[day] : priceAt(market, ticker, to),
      });
    }

    for (const w of WORKERS) {
      const snap = this.snapshot(w.id, to);
      // Idle ATR distance only needs coarse updates; while charging it tracks the charge.
      const atrKey = snap.status === 'charging' || snap.status === 'ready' ? snap.atrAway.toFixed(2) : snap.atrAway.toFixed(1);
      const key = `${snap.status}|${snap.direction}|${Math.round(snap.charge)}|${atrKey}`;
      if (key !== this.lastStatus[w.id] || initial) {
        this.lastStatus[w.id] = key;
        const ev: BotStatusEvent = {
          type: 'BOT_STATUS',
          workerId: w.id,
          status: snap.status,
          direction: snap.direction,
          charge: snap.charge,
          atrAway: snap.atrAway,
        };
        out.push(ev);
      }
    }
  }

  private toEvents(item: QueueItem, out: BotEvent[]): void {
    const minuteOf = (t: number) => t - item.dayIndex * SESSION_MINUTES;
    switch (item.kind) {
      case 'session-open':
        out.push({ type: 'SESSION', dayIndex: item.dayIndex, phase: 'open' });
        return;
      case 'session-close':
        out.push({ type: 'SESSION', dayIndex: item.dayIndex, phase: 'close' });
        return;
      case 'arm': {
        const w = WORKER_BY_ID[item.workerId!];
        const dir = item.trade?.direction ?? item.fizzle?.direction ?? 'CALL';
        out.push({
          type: 'THOUGHT',
          workerId: w.id,
          dayIndex: item.dayIndex,
          minute: minuteOf(item.t),
          text: `signal armed · ${w.setupName} ${ARROW[dir]} ${dir}`,
          tone: 'info',
        });
        return;
      }
      case 'fizzle-end': {
        const f = item.fizzle!;
        out.push({
          type: 'THOUGHT',
          workerId: f.workerId,
          dayIndex: item.dayIndex,
          minute: minuteOf(item.t),
          text: `setup faded at ${f.peakCharge}% · standing down`,
          tone: 'warn',
        });
        return;
      }
      case 'fire': {
        const tr = item.trade!;
        out.push({
          type: 'TRADE_EXECUTED',
          workerId: tr.workerId,
          tradeId: tr.id,
          ticker: tr.ticker,
          direction: tr.direction,
          contracts: tr.contracts,
          entry: tr.entryPrice,
          underlying: tr.underlyingPrice,
          dayIndex: item.dayIndex,
          minute: minuteOf(item.t),
          timestamp: item.t,
        });
        return;
      }
      case 'trail': {
        const tr = item.trade!;
        const stop = tr.entryPrice + (tr.exitPrice - tr.entryPrice) * 0.55;
        out.push({
          type: 'THOUGHT',
          workerId: tr.workerId,
          dayIndex: item.dayIndex,
          minute: minuteOf(item.t),
          text:
            tr.pnl >= 0
              ? `trailing stop moved → ${Math.max(0.05, stop).toFixed(2)}`
              : `under water · stop held ${formatMoney(tr.pnl * 0.4)}`,
          tone: tr.pnl >= 0 ? 'info' : 'warn',
        });
        return;
      }
      case 'close': {
        const tr = item.trade!;
        out.push({
          type: 'TRADE_CLOSED',
          workerId: tr.workerId,
          tradeId: tr.id,
          pnl: tr.pnl,
          exit: tr.exitPrice,
          reason: tr.exitReason,
          dayIndex: item.dayIndex,
          minute: minuteOf(item.t),
          timestamp: item.t,
          underlying: priceAt(this.schedule.market, tr.ticker, item.t),
        });
        return;
      }
    }
  }
}
