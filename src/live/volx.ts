/**
 * VolX desk → city events (pure).
 *
 * The desk (mes-orb-bot's IB paper node) narrates every decision as a
 * DashboardEvent in dashboard/live_log.jsonl; the local `volxdesk` bridge
 * serves those events plus compacted MES minute bars. This maps them onto the
 * left tower:
 *
 * - `armed` → the tower charges toward whichever breakout stop the price is
 *   closer to (charge = how much of the breakout width has been covered).
 * - an entry `order_filled` → FIRE (BUY = long = CALL colours, SELL = short).
 * - `position_closed` → realized P&L into the vault (paper money).
 * - everything else the desk says becomes a THOUGHT.
 */
import type { OpenPosition, OptionDirection, Ticker, WorkerId } from '../types/trading';
import { ALL_TICKERS } from '../types/trading';
import {
  arr,
  barsToPoints,
  clip,
  num,
  obj,
  priceAt,
  str,
  type FeedOutput,
  type KeyedEvent,
  type RawBar,
  type WorkerLiveState,
} from './feed';
import { toEt, type LiveCalendar } from './marketClock';

export interface DeskEvent {
  seq: number;
  ts: string;
  kind: string;
  symbol: string;
  strategy: string;
  text: string;
  data: Record<string, unknown>;
}

export const CHART_SYMBOL = 'MES';

export function parseDeskEvents(list: unknown): DeskEvent[] {
  return arr(list)
    .map(obj)
    .filter((e) => typeof e.kind === 'string' && typeof e.ts === 'string' && e.ts !== '')
    .map((e) => ({
      seq: num(e.seq, 0),
      ts: str(e.ts),
      kind: str(e.kind),
      symbol: str(e.symbol).toUpperCase(),
      strategy: str(e.strategy),
      text: str(e.text),
      data: obj(e.data),
    }));
}

/** Bars as `[t, o, h, l, c, v]` rows (t = ISO string or epoch ms) or `{t, o, h, l, c, v}` objects. */
export function parseDeskBars(list: unknown): RawBar[] {
  const out: RawBar[] = [];
  for (const row of arr(list)) {
    const r = Array.isArray(row) ? { t: row[0], o: row[1], h: row[2], l: row[3], c: row[4], v: row[5] } : obj(row);
    const t = typeof r.t === 'number' ? r.t : Date.parse(str(r.t));
    const c = num(r.c);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    out.push({ t, o: num(r.o, c), h: num(r.h, c), l: num(r.l, c), c, v: num(r.v, 0) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Merges bar updates into a set keyed by minute (the newest copy of a minute wins). */
export function mergeBars(into: Map<number, RawBar>, bars: readonly RawBar[], keepAfterMs: number): void {
  for (const b of bars) into.set(b.t, b);
  for (const t of into.keys()) if (t < keepAfterMs) into.delete(t);
}

const eventTime = (e: DeskEvent) => Date.parse(e.ts);

export const deskEventKey = (e: DeskEvent) => `${e.ts}|${e.kind}|${e.symbol}|${e.seq}`;

const tickerOf = (symbol: string): Ticker => ((ALL_TICKERS as readonly string[]).includes(symbol) ? (symbol as Ticker) : 'MES');

export interface VolxDeriveInput {
  workerId: WorkerId;
  startMs: number;
  events: readonly DeskEvent[];
  bars: readonly RawBar[];
  /** False until the first desk payload (or synced copy) arrives. */
  ready: boolean;
  /** The data is an old synced copy: don't animate a live charge from it. */
  stale?: boolean;
  cal: LiveCalendar;
  nowMs: number;
}

interface Held {
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  key: string;
  ts: number;
}

export function deriveVolx(input: VolxDeriveInput): FeedOutput & { equity: number | null; lastEventMs: number | null } {
  const { workerId, startMs, cal, nowMs, bars } = input;
  const events: KeyedEvent[] = [];
  const held = new Map<string, Held>();
  let armed: { date: string; buy: number; sell: number; width: number; filled: boolean } | null = null;
  let doneDate = '';
  let equity: number | null = null;
  let lastEventMs: number | null = null;

  const sorted = [...input.events].sort((a, b) => eventTime(a) - eventTime(b) || a.seq - b.seq);
  for (const e of sorted) {
    const t = eventTime(e);
    if (!Number.isFinite(t)) continue;
    lastEventMs = Math.max(lastEventMs ?? 0, t);
    const emit = t >= startMs;
    const loc = cal.locate(t);
    const key = `volx:${deskEventKey(e)}`;
    const thought = (text: string, tone: 'action' | 'profit' | 'loss' | 'warn' | 'info' = 'info') => {
      if (emit && text)
        events.push({
          key,
          ts: loc.timestamp,
          ev: { type: 'THOUGHT', workerId, dayIndex: loc.dayIndex, minute: loc.minute, text: clip(text), tone },
        });
    };
    const d = e.data;
    switch (e.kind) {
      case 'connection': {
        const status = str(d.status);
        if (status) thought(`desk ${status === 'live' ? 'connected · IB paper' : status}`, status === 'live' ? 'info' : 'warn');
        break;
      }
      case 'watching':
      case 'order_canceled':
        thought(e.text);
        break;
      case 'armed': {
        const buy = num(d.buy_level);
        const sell = num(d.sell_level);
        if (Number.isFinite(buy) && Number.isFinite(sell)) {
          const width = num(d.width, (buy - sell) / 2);
          if (e.symbol === CHART_SYMBOL) armed = { date: toEt(t).date, buy, sell, width, filled: false };
          thought(`armed ${e.symbol}: BUY > ${buy.toFixed(2)} · SELL < ${sell.toFixed(2)} (width ${width.toFixed(2)})`, 'action');
        }
        break;
      }
      case 'order_filled': {
        const side = str(d.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const price = num(d.price);
        const qty = Math.max(1, Math.round(num(d.qty, 1)));
        if (!Number.isFinite(price)) break;
        const pos = held.get(e.symbol);
        if (!pos) {
          held.set(e.symbol, { side, qty, price, key, ts: loc.timestamp });
          if (armed && e.symbol === CHART_SYMBOL) armed.filled = true;
          const direction: OptionDirection = side === 'BUY' ? 'CALL' : 'PUT';
          if (emit)
            events.push({
              key,
              ts: loc.timestamp,
              ev: {
                type: 'TRADE_EXECUTED',
                workerId,
                tradeId: key,
                ticker: tickerOf(e.symbol),
                direction,
                contracts: qty,
                entry: price,
                underlying: e.symbol === CHART_SYMBOL ? price : 0,
                dayIndex: loc.dayIndex,
                minute: loc.minute,
                timestamp: loc.timestamp,
                note: `${side === 'BUY' ? 'long' : 'short'} ${e.symbol} x${qty} @ ${price.toFixed(2)}`,
              },
            });
        } else if (pos.side === side) {
          pos.qty += qty;
          thought(`added ${e.symbol} x${qty} @ ${price.toFixed(2)}`, 'action');
        } else {
          thought(`exit fill ${e.symbol} @ ${price.toFixed(2)}`);
        }
        break;
      }
      case 'exits_attached': {
        const stop = num(d.stop);
        const target = num(d.target);
        if (Number.isFinite(stop) && Number.isFinite(target))
          thought(`bracket ${e.symbol}: stop ${stop.toFixed(2)} · target ${target.toFixed(2)}`);
        break;
      }
      case 'position_closed': {
        const pos = held.get(e.symbol);
        held.delete(e.symbol);
        if (e.symbol === CHART_SYMBOL) doneDate = toEt(t).date;
        const pnl = num(d.pnl);
        if (!emit) break;
        if (!Number.isFinite(pnl)) {
          thought(`${e.symbol} position closed`);
          break;
        }
        events.push({
          key,
          ts: loc.timestamp + 0.1,
          ev: {
            type: 'TRADE_CLOSED',
            workerId,
            tradeId: pos?.key ?? key,
            pnl: Math.round(pnl * 100) / 100,
            exit: 0,
            reason: pnl >= 0 ? 'target' : 'stop',
            dayIndex: loc.dayIndex,
            minute: loc.minute,
            timestamp: loc.timestamp,
            underlying: e.symbol === CHART_SYMBOL ? priceAt(bars, t) : 0,
            note: `${e.symbol} closed`,
          },
        });
        break;
      }
      case 'flatten':
      case 'roll_detected':
      case 'roll_skip':
        thought(e.text, 'warn');
        break;
      case 'overnight_decision':
        thought(e.text, d.enter === true ? 'action' : 'info');
        break;
      case 'account_state': {
        const eq = num(d.equity);
        if (Number.isFinite(eq)) equity = eq;
        break;
      }
    }
  }

  // Tower state.
  const last = bars.length ? bars[bars.length - 1] : null;
  const phase = cal.phase(nowMs);
  const today = toEt(nowMs).date;
  const chartPos = held.get(CHART_SYMBOL) ?? [...held.values()][0];
  let position: OpenPosition | null = null;
  let status: WorkerLiveState['status'];
  if (!input.ready) status = { status: 'off-duty', direction: null, charge: 0 };
  else if (chartPos) {
    const direction: OptionDirection = chartPos.side === 'BUY' ? 'CALL' : 'PUT';
    position = {
      tradeId: chartPos.key,
      direction,
      contracts: chartPos.qty,
      entryPrice: chartPos.price,
      underlyingPrice: chartPos.price,
      openedAt: chartPos.ts,
    };
    status = { status: 'managing', direction, charge: 0 };
  } else if (phase !== 'open') status = { status: 'off-duty', direction: null, charge: 0 };
  else if (armed && armed.date === today && !armed.filled && last && !input.stale) {
    const toBuy = armed.buy - last.c;
    const toSell = last.c - armed.sell;
    const nearer = Math.min(toBuy, toSell);
    const charge = Math.round(Math.max(0, Math.min(1, 1 - nearer / Math.max(armed.width, 0.25))) * 100);
    status = {
      status: charge >= 85 ? 'ready' : 'charging',
      direction: toBuy <= toSell ? 'CALL' : 'PUT',
      charge,
      atrAway: Math.max(0, nearer),
    };
  } else status = { status: doneDate === today ? 'cooldown' : 'watching', direction: null, charge: 0 };

  return {
    events,
    bars: { MES: barsToPoints(bars, cal) },
    prices: last ? { MES: last.c } : {},
    workers: { [workerId]: { status, position } },
    equity,
    lastEventMs,
  };
}
