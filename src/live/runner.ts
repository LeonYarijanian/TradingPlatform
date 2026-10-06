/**
 * Live runner: one ET wall clock plus every live feed, merged into the same
 * BotEvent stream the demo engine produces.
 *
 * Feeds re-derive from their raw data whenever it changes; the runner keeps
 * what it already ingested (keys for one-shot events, last values for state)
 * and sends the store only what is new. A realized-P&L entry that grows after
 * it was booked (legs reported across two polls) is topped up with the
 * difference, so the vault always equals the source's total.
 */
import { SESSION_MINUTES } from '../data/demoRun';
import { useSim } from '../simulation/simulationStore';
import type { BotEvent, MarketPoint, Ticker } from '../types/trading';
import { LIVE_START } from './config';
import type { FeedOutput, KeyedEvent } from './feed';
import { useLive } from './liveStore';
import { LiveCalendar, OPEN_MINUTE_OF_DAY, sessionLength, toEt } from './marketClock';

export interface LiveFeed {
  start(cal: LiveCalendar, changed: () => void): void;
  /** Called when the trading calendar rolls to a new day. */
  setCalendar?(cal: LiveCalendar): void;
  stop(): void;
  derive(cal: LiveCalendar, nowMs: number): FeedOutput;
}

/** Session open/close markers for every day up to now. */
export function sessionEvents(cal: LiveCalendar, nowMs: number): KeyedEvent[] {
  const out: KeyedEvent[] = [];
  const et = toEt(nowMs);
  const minute = et.minuteOfDay - OPEN_MINUTE_OF_DAY;
  cal.days.forEach((d, i) => {
    const isToday = d.date === et.date;
    const opened = !isToday || minute >= 0;
    const closed = !isToday || minute >= sessionLength(d.date);
    if (opened)
      out.push({ key: `session:open:${d.date}`, ts: i * SESSION_MINUTES - 0.5, ev: { type: 'SESSION', dayIndex: i, phase: 'open' } });
    if (closed)
      out.push({
        key: `session:close:${d.date}`,
        ts: (i + 1) * SESSION_MINUTES - 0.25,
        ev: { type: 'SESSION', dayIndex: i, phase: 'close' },
      });
  });
  return out;
}

export class LiveRunner {
  private cal: LiveCalendar;
  private emitted = new Set<string>();
  private bookedPnl = new Map<string, number>();
  private lastState = new Map<string, string>();
  private lastBars = new Map<Ticker, MarketPoint>();
  private lastPrice = new Map<Ticker, number>();
  private lastClock = '';
  private timer = 0;
  private pending = 0;
  private lastFlush = 0;
  private running = false;

  constructor(
    private readonly feeds: readonly LiveFeed[],
    private readonly now: () => number = () => Date.now(),
  ) {
    this.cal = new LiveCalendar(LIVE_START, toEt(this.now()).date);
  }

  get calendar(): LiveCalendar {
    return this.cal;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.init();
    for (const f of this.feeds) f.start(this.cal, () => this.schedule());
    this.flush();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.timer);
    window.clearTimeout(this.pending);
    for (const f of this.feeds) f.stop();
  }

  /** Coalesces bursts of feed updates into one flush. */
  private schedule(): void {
    if (this.pending || !this.running) return;
    this.pending = window.setTimeout(() => {
      this.pending = 0;
      this.flush();
    }, 60);
  }

  private init(): void {
    this.emitted.clear();
    this.bookedPnl.clear();
    this.lastState.clear();
    this.lastBars.clear();
    this.lastPrice.clear();
    this.lastClock = '';
    useSim.getState().ingest([{ type: 'RUN_INIT', days: this.cal.days.map((d) => ({ date: d.date, label: d.label })) }]);
  }

  private tick(): void {
    const now = this.now();
    const today = toEt(now).date;
    if (today > this.cal.today) {
      // Midnight ET: rebuild the run with the new day and replay every feed.
      this.cal = new LiveCalendar(LIVE_START, today);
      this.init();
      for (const f of this.feeds) f.setCalendar?.(this.cal);
      this.flush();
      return;
    }
    // Feeds also depend on time (market open/close, expirations): re-derive every few seconds.
    if (now - this.lastFlush > 5000) this.flush();
    else this.ingest(this.clockEvents(now));
  }

  private clockEvents(now: number): BotEvent[] {
    const et = toEt(now);
    const loc = this.cal.locate(now);
    const phase = this.cal.phase(now);
    const label = dateLabel(et.date);
    const wall = et.minuteOfDay - OPEN_MINUTE_OF_DAY;
    const live = useLive.getState().clock;
    if (!live || live.phase !== phase || live.label !== label || Math.floor(live.minute) !== Math.floor(wall)) {
      useLive.setState({ clock: { label, minute: wall, phase } });
    }
    const key = `${loc.dayIndex}:${Math.floor(loc.minute * 4)}`;
    if (key === this.lastClock) return [];
    this.lastClock = key;
    return [{ type: 'CLOCK', dayIndex: Math.max(0, loc.dayIndex), minute: loc.minute, finished: false }];
  }

  /** Re-derive every feed and ingest what changed. */
  flush(): void {
    const now = this.now();
    this.lastFlush = now;
    const outputs: FeedOutput[] = [{ events: sessionEvents(this.cal, now) }, ...this.feeds.map((f) => f.derive(this.cal, now))];
    const batch: BotEvent[] = [];

    for (const out of outputs) {
      for (const [ticker, points] of Object.entries(out.bars ?? {}) as Array<[Ticker, MarketPoint[]]>) {
        const prev = this.lastBars.get(ticker);
        for (const p of points) {
          if (prev && (p.timestamp < prev.timestamp || (p.timestamp === prev.timestamp && p.price === prev.price && p.vwap === prev.vwap)))
            continue;
          batch.push({ type: 'MARKET_BAR', ticker, point: p });
        }
        if (points.length) this.lastBars.set(ticker, points[points.length - 1]);
      }
    }

    const fresh: KeyedEvent[] = [];
    for (const out of outputs) {
      for (const k of out.events) {
        if (k.ev.type === 'TRADE_CLOSED') {
          const booked = this.bookedPnl.get(k.key);
          if (booked === undefined) {
            this.bookedPnl.set(k.key, k.ev.pnl);
            fresh.push(k);
          } else if (Math.abs(booked - k.ev.pnl) >= 0.005) {
            this.bookedPnl.set(k.key, k.ev.pnl);
            const delta = Math.round((k.ev.pnl - booked) * 100) / 100;
            fresh.push({ ...k, ev: { ...k.ev, tradeId: `${k.key}#${delta}`, pnl: delta, note: `${k.ev.note ?? 'adjustment'} (adj.)` } });
          }
          continue;
        }
        if (this.emitted.has(k.key)) continue;
        this.emitted.add(k.key);
        fresh.push(k);
      }
    }
    fresh.sort((a, b) => a.ts - b.ts);
    for (const k of fresh) batch.push(k.ev);

    for (const out of outputs) {
      for (const [ticker, price] of Object.entries(out.prices ?? {}) as Array<[Ticker, number]>) {
        if (!(price > 0) || this.lastPrice.get(ticker) === price) continue;
        this.lastPrice.set(ticker, price);
        batch.push({ type: 'MARKET_TICK', ticker, timestamp: this.lastBars.get(ticker)?.timestamp ?? 0, price });
      }
      for (const [workerId, state] of Object.entries(out.workers ?? {})) {
        if (!state) continue;
        const id = workerId as keyof NonNullable<FeedOutput['workers']>;
        const statusJson = JSON.stringify(state.status);
        if (this.lastState.get(`s:${id}`) !== statusJson) {
          this.lastState.set(`s:${id}`, statusJson);
          batch.push({ type: 'BOT_STATUS', workerId: id, ...state.status });
        }
        const posJson = JSON.stringify(state.position);
        if (this.lastState.get(`p:${id}`) !== posJson) {
          this.lastState.set(`p:${id}`, posJson);
          batch.push({ type: 'POSITION', workerId: id, position: state.position });
        }
      }
    }
    batch.push(...this.clockEvents(now));
    this.ingest(batch);
  }

  private ingest(events: BotEvent[]): void {
    if (events.length) useSim.getState().ingest(events);
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sat 10/10" for any ET date (the live HUD shows weekends too). */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}
