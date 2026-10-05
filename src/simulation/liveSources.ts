/**
 * Live-data adapters.
 *
 * The UI only ever consumes `BotEvent`s (see src/types/trading.ts). The demo
 * engine is one producer; these adapters let a real backend — a websocket
 * feed, server-sent events, a backtest replay service or a Python bot API —
 * drive the exact same city, workstation, ticker and vault.
 *
 * Nothing here can place orders: it is a read-only event consumer.
 */
import { WORKER_IDS } from '../data/workers';
import type {
  BotEvent,
  BotEventSource,
  MarketDataProvider,
  MarketTick,
  OptionDirection,
  Ticker,
  WorkerId,
  WorkerStatus,
} from '../types/trading';
import { useSim } from './simulationStore';

const STATUSES: readonly WorkerStatus[] = ['watching', 'scanning', 'charging', 'ready', 'firing', 'managing', 'trailing', 'cooldown', 'off-duty'];
const TICKERS: readonly Ticker[] = ['QQQ', 'SPY', 'IWM'];

type Raw = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const pick = (o: Raw, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

function workerId(o: Raw): WorkerId | null {
  const id = str(pick(o, 'workerId', 'worker_id', 'worker', 'bot'));
  return id && (WORKER_IDS as readonly string[]).includes(id) ? (id as WorkerId) : null;
}

function direction(v: unknown): OptionDirection | null {
  const d = str(v)?.toUpperCase();
  return d === 'CALL' || d === 'PUT' ? d : null;
}

function ticker(v: unknown): Ticker | null {
  const t = str(v)?.toUpperCase();
  return t && (TICKERS as readonly string[]).includes(t) ? (t as Ticker) : null;
}

/** Current clock from the store, used to fill timestamps a backend omits. */
function now() {
  const { clock } = useSim.getState();
  return { dayIndex: clock.dayIndex, minute: clock.minute, timestamp: clock.dayIndex * 390 + clock.minute };
}

/**
 * Normalizes one backend message into protocol events. Accepts camelCase or
 * snake_case keys and fills sensible defaults, e.g.
 *
 *   {"type":"BOT_STATUS","workerId":"qqq-trend","status":"charging","direction":"CALL","charge":68}
 *   {"type":"TRADE_EXECUTED","workerId":"qqq-og","ticker":"QQQ","direction":"CALL","contracts":7,"entry":3.53,"underlying":715.80}
 *   {"type":"TRADE_CLOSED","workerId":"qqq-og","pnl":161}
 */
export function normalizeEvent(input: unknown): BotEvent | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Raw;
  const type = str(o.type)?.toUpperCase();
  const t = now();
  switch (type) {
    case 'RUN_INIT': {
      const days = Array.isArray(o.days) ? o.days : [];
      return {
        type: 'RUN_INIT',
        days: days.map((d: unknown, i) => {
          const r = (d ?? {}) as Raw;
          return { date: str(r.date) ?? `day-${i + 1}`, label: str(r.label) ?? str(r.date) ?? `Day ${i + 1}` };
        }),
      };
    }
    case 'CLOCK':
      return { type: 'CLOCK', dayIndex: num(pick(o, 'dayIndex', 'day_index'), t.dayIndex), minute: num(o.minute, t.minute), finished: o.finished === true };
    case 'SESSION': {
      const phase = str(o.phase) === 'close' ? 'close' : 'open';
      return { type: 'SESSION', dayIndex: num(pick(o, 'dayIndex', 'day_index'), t.dayIndex), phase };
    }
    case 'MARKET_TICK': {
      const tk = ticker(o.ticker);
      if (!tk) return null;
      return { type: 'MARKET_TICK', ticker: tk, timestamp: num(o.timestamp, t.timestamp), price: num(o.price) };
    }
    case 'MARKET_BAR': {
      const tk = ticker(o.ticker);
      const p = (o.point ?? o) as Raw;
      if (!tk) return null;
      return {
        type: 'MARKET_BAR',
        ticker: tk,
        point: { timestamp: num(p.timestamp, t.timestamp), price: num(p.price), vwap: num(p.vwap, num(p.price)), ema50: num(pick(p, 'ema50', 'ema_50'), num(p.price)) },
      };
    }
    case 'BOT_STATUS': {
      const id = workerId(o);
      const status = str(o.status)?.toLowerCase() as WorkerStatus | undefined;
      if (!id || !status || !STATUSES.includes(status)) return null;
      return {
        type: 'BOT_STATUS',
        workerId: id,
        status,
        direction: direction(o.direction),
        charge: Math.max(0, Math.min(100, num(o.charge))),
        atrAway: o.atrAway !== undefined || o.atr_away !== undefined ? num(pick(o, 'atrAway', 'atr_away')) : undefined,
      };
    }
    case 'TRADE_EXECUTED': {
      const id = workerId(o);
      const dir = direction(o.direction);
      if (!id || !dir) return null;
      return {
        type: 'TRADE_EXECUTED',
        workerId: id,
        tradeId: str(pick(o, 'tradeId', 'trade_id')) ?? `${id}-${Date.now()}`,
        ticker: ticker(o.ticker) ?? 'QQQ',
        direction: dir,
        contracts: Math.max(1, Math.round(num(o.contracts, 1))),
        entry: num(pick(o, 'entry', 'entryPrice', 'entry_price')),
        underlying: num(pick(o, 'underlying', 'underlyingPrice', 'underlying_price')),
        dayIndex: num(pick(o, 'dayIndex', 'day_index'), t.dayIndex),
        minute: num(o.minute, t.minute),
        timestamp: num(o.timestamp, t.timestamp),
      };
    }
    case 'TRADE_CLOSED': {
      const id = workerId(o);
      if (!id) return null;
      const pnl = num(o.pnl);
      const reason = str(o.reason);
      return {
        type: 'TRADE_CLOSED',
        workerId: id,
        tradeId: str(pick(o, 'tradeId', 'trade_id')) ?? `${id}-close-${Date.now()}`,
        pnl,
        exit: num(pick(o, 'exit', 'exitPrice', 'exit_price')),
        reason: reason === 'target' || reason === 'stop' || reason === 'time' || reason === 'trail' ? reason : pnl >= 0 ? 'trail' : 'stop',
        dayIndex: num(pick(o, 'dayIndex', 'day_index'), t.dayIndex),
        minute: num(o.minute, t.minute),
        timestamp: num(o.timestamp, t.timestamp),
        underlying: num(pick(o, 'underlying', 'underlyingPrice', 'underlying_price')),
      };
    }
    case 'THOUGHT': {
      const id = workerId(o);
      const text = str(o.text);
      if (!id || !text) return null;
      const tone = str(o.tone);
      return {
        type: 'THOUGHT',
        workerId: id,
        dayIndex: num(pick(o, 'dayIndex', 'day_index'), t.dayIndex),
        minute: num(o.minute, t.minute),
        text,
        tone: tone === 'action' || tone === 'profit' || tone === 'loss' || tone === 'warn' ? tone : 'info',
      };
    }
    default:
      return null;
  }
}

/** Parses a raw message (single event or array) into protocol events. */
export function parseMessage(raw: string): BotEvent[] {
  try {
    const data: unknown = JSON.parse(raw);
    const list = Array.isArray(data) ? data : [data];
    return list.map(normalizeEvent).filter((e): e is BotEvent => e !== null);
  } catch {
    return [];
  }
}

/** Websocket feed with automatic reconnect. */
export class WebSocketEventSource implements BotEventSource {
  constructor(
    private readonly url: string,
    private readonly reconnectMs = 2000,
  ) {}

  subscribe(listener: (events: BotEvent[]) => void): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer = 0;
    const open = () => {
      ws = new WebSocket(this.url);
      ws.onmessage = (m) => {
        const events = parseMessage(String(m.data));
        if (events.length) listener(events);
      };
      ws.onclose = () => {
        if (!closed) timer = window.setTimeout(open, this.reconnectMs);
      };
    };
    open();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }
}

/** Server-sent events feed (EventSource reconnects on its own). */
export class SSEEventSource implements BotEventSource {
  constructor(private readonly url: string) {}

  subscribe(listener: (events: BotEvent[]) => void): () => void {
    const es = new EventSource(this.url);
    es.onmessage = (m) => {
      const events = parseMessage(String(m.data));
      if (events.length) listener(events);
    };
    return () => es.close();
  }
}

/** Adapts a price-only provider into MARKET_TICK events. */
export class MarketTickSource implements BotEventSource {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly tickers: readonly Ticker[] = TICKERS,
  ) {}

  subscribe(listener: (events: BotEvent[]) => void): () => void {
    const unsubs = this.tickers.map((tk) =>
      this.provider.subscribe(tk, (tick: MarketTick) => listener([{ type: 'MARKET_TICK', ticker: tick.ticker, timestamp: tick.timestamp, price: tick.price }])),
    );
    return () => unsubs.forEach((u) => u());
  }
}

/** Pipes any event source into the store. Returns an unsubscribe function. */
export function connectSource(source: BotEventSource): () => void {
  return source.subscribe((events) => useSim.getState().ingest(events));
}
