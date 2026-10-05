import { WORKERS, WORKER_BY_ID } from '../data/workers';
import type {
  BotEvent,
  ChartMarker,
  LogEntry,
  LogTone,
  OptionDirection,
  Ticker,
  WorkerId,
  WorkerRuntime,
} from '../types/trading';
import { formatMoney } from './pnl';

export interface DayRuntime {
  index: number;
  date: string;
  label: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  status: 'pending' | 'active' | 'done';
}

/** Monotonic counters that 3D effects watch to trigger real-time animations. */
export interface WorkerFx {
  fireSeq: number;
  closeSeq: number;
  lastPnl: number;
  lastDirection: OptionDirection | null;
}

export interface PriceState {
  price: number;
  dayOpen: number;
  changePct: number;
  timestamp: number;
}

export interface SimData {
  runId: number;
  clock: { dayIndex: number; minute: number; finished: boolean };
  days: DayRuntime[];
  workers: Record<WorkerId, WorkerRuntime>;
  vault: number;
  vaultSeq: number;
  lastDeposit: { workerId: WorkerId; amount: number } | null;
  /** Global event ticker, newest first. */
  ticker: LogEntry[];
  /** Per-worker "THOUGHTS", newest first. */
  thoughts: Record<WorkerId, LogEntry[]>;
  /** Chart markers (entries/exits), oldest first. */
  markers: ChartMarker[];
  fx: Record<WorkerId, WorkerFx>;
  prices: Record<Ticker, PriceState>;
  logSeq: number;
}

export const TICKER_LIMIT = 80;
export const THOUGHT_LIMIT = 40;
export const MARKER_LIMIT = 600;

function freshWorker(id: WorkerId): WorkerRuntime {
  const w = WORKER_BY_ID[id];
  return {
    id,
    ticker: w.ticker,
    status: 'off-duty',
    direction: null,
    charge: 0,
    earned: 0,
    atrAway: 4,
    todayPnl: 0,
    tradesToday: 0,
    wins: 0,
    losses: 0,
    position: null,
    lastPnl: null,
  };
}

function record<T>(make: (id: WorkerId) => T): Record<WorkerId, T> {
  return Object.fromEntries(WORKERS.map((w) => [w.id, make(w.id)])) as Record<WorkerId, T>;
}

export function createInitialSimData(runId = 0, days: DayRuntime[] = []): SimData {
  return {
    runId,
    clock: { dayIndex: 0, minute: 0, finished: false },
    days,
    workers: record(freshWorker),
    vault: 0,
    vaultSeq: 0,
    lastDeposit: null,
    ticker: [],
    thoughts: record(() => []),
    markers: [],
    fx: record(() => ({ fireSeq: 0, closeSeq: 0, lastPnl: 0, lastDirection: null })),
    prices: {
      QQQ: { price: 0, dayOpen: NaN, changePct: 0, timestamp: 0 },
      SPY: { price: 0, dayOpen: NaN, changePct: 0, timestamp: 0 },
      IWM: { price: 0, dayOpen: NaN, changePct: 0, timestamp: 0 },
    },
    logSeq: 0,
  };
}

const ARROWS: Record<OptionDirection, string> = { CALL: '▲', PUT: '▼' };

function closeText(reason: string, pnl: number): { text: string; tone: LogTone } {
  const money = formatMoney(pnl);
  if (pnl >= 0) {
    if (reason === 'target') return { text: `🎯 target hit ${money}`, tone: 'profit' };
    return { text: `🔥 rode the trail ${money}`, tone: 'profit' };
  }
  if (reason === 'time') return { text: `time stop ${money}`, tone: 'loss' };
  return { text: `stopped out ${money}`, tone: 'loss' };
}

/**
 * Applies a batch of protocol events. Pure with respect to `state`: the input
 * is never mutated; touched branches are copied once per batch.
 */
export function reduceEvents(state: SimData, events: readonly BotEvent[]): SimData {
  if (events.length === 0) return state;
  let s: SimData = { ...state };
  const touched = new Set<string>();
  const touch = <K extends keyof SimData>(key: K): SimData[K] => {
    if (!touched.has(key)) {
      touched.add(key);
      const v = s[key];
      (s as unknown as Record<string, unknown>)[key] = Array.isArray(v) ? [...v] : { ...(v as object) };
    }
    return s[key];
  };
  const touchedWorkers = new Set<WorkerId>();
  const worker = (id: WorkerId): WorkerRuntime => {
    const workers = touch('workers');
    if (!touchedWorkers.has(id)) {
      touchedWorkers.add(id);
      workers[id] = { ...workers[id] };
    }
    return workers[id];
  };
  const touchedDays = new Set<number>();
  const day = (index: number): DayRuntime | undefined => {
    const days = touch('days');
    if (!days[index]) return undefined;
    if (!touchedDays.has(index)) {
      touchedDays.add(index);
      days[index] = { ...days[index] };
    }
    return days[index];
  };
  const touchedThoughts = new Set<WorkerId>();
  const pushLog = (entry: Omit<LogEntry, 'id'>, toThoughts = true, toTicker = true) => {
    s.logSeq += 1;
    const full: LogEntry = { ...entry, id: `log-${s.runId}-${s.logSeq}` };
    if (toTicker) {
      const ticker = touch('ticker');
      ticker.unshift(full);
      if (ticker.length > TICKER_LIMIT) ticker.length = TICKER_LIMIT;
    }
    if (toThoughts) {
      const thoughts = touch('thoughts');
      if (!touchedThoughts.has(entry.workerId)) {
        touchedThoughts.add(entry.workerId);
        thoughts[entry.workerId] = [...thoughts[entry.workerId]];
      }
      const list = thoughts[entry.workerId];
      list.unshift(full);
      if (list.length > THOUGHT_LIMIT) list.length = THOUGHT_LIMIT;
    }
  };
  const touchedFx = new Set<WorkerId>();
  const fx = (id: WorkerId) => {
    const all = touch('fx');
    if (!touchedFx.has(id)) {
      touchedFx.add(id);
      all[id] = { ...all[id] };
    }
    return all[id];
  };
  const setPrice = (ticker: Ticker, price: number, timestamp: number) => {
    const prices = touch('prices');
    const prev = prices[ticker];
    const dayOpen = Number.isNaN(prev.dayOpen) ? price : prev.dayOpen;
    prices[ticker] = { price, dayOpen, changePct: ((price - dayOpen) / dayOpen) * 100, timestamp };
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'RUN_INIT': {
        s = createInitialSimData(
          state.runId + 1,
          ev.days.map((d, index) => ({
            index,
            date: d.date,
            label: d.label,
            pnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            status: 'pending' as const,
          })),
        );
        touched.clear();
        touchedWorkers.clear();
        touchedDays.clear();
        touchedThoughts.clear();
        touchedFx.clear();
        // Fresh objects — treat every branch as already copied.
        for (const k of Object.keys(s)) touched.add(k);
        for (const w of WORKERS) {
          touchedWorkers.add(w.id);
          touchedThoughts.add(w.id);
          touchedFx.add(w.id);
        }
        s.days.forEach((_, i) => touchedDays.add(i));
        break;
      }
      case 'CLOCK':
        s.clock = { dayIndex: ev.dayIndex, minute: ev.minute, finished: ev.finished };
        break;
      case 'SESSION': {
        if (ev.phase === 'open') {
          for (let i = 0; i < ev.dayIndex; i++) {
            const prev = day(i);
            if (prev && prev.status !== 'done') prev.status = 'done';
          }
          const d = day(ev.dayIndex);
          if (d) d.status = 'active';
          for (const w of WORKERS) {
            const rt = worker(w.id);
            rt.todayPnl = 0;
            rt.tradesToday = 0;
          }
          const prices = touch('prices');
          for (const t of Object.keys(prices) as Ticker[]) prices[t] = { ...prices[t], dayOpen: NaN };
        } else {
          const d = day(ev.dayIndex);
          if (d) d.status = 'done';
        }
        break;
      }
      case 'MARKET_TICK':
        setPrice(ev.ticker, ev.price, ev.timestamp);
        break;
      case 'MARKET_BAR':
        if (Number.isNaN(s.prices[ev.ticker].dayOpen)) setPrice(ev.ticker, ev.point.price, ev.point.timestamp);
        break;
      case 'BOT_STATUS': {
        const rt = worker(ev.workerId);
        rt.status = ev.status;
        rt.direction = ev.direction;
        rt.charge = ev.charge;
        if (ev.atrAway !== undefined) rt.atrAway = ev.atrAway;
        break;
      }
      case 'TRADE_EXECUTED': {
        const rt = worker(ev.workerId);
        rt.position = {
          tradeId: ev.tradeId,
          direction: ev.direction,
          contracts: ev.contracts,
          entryPrice: ev.entry,
          underlyingPrice: ev.underlying,
          openedAt: ev.timestamp,
        };
        rt.tradesToday += 1;
        const f = fx(ev.workerId);
        f.fireSeq += 1;
        f.lastDirection = ev.direction;
        const markers = touch('markers');
        markers.push({
          id: `${ev.tradeId}-in`,
          workerId: ev.workerId,
          timestamp: ev.timestamp,
          price: ev.underlying,
          direction: ev.direction,
          kind: 'entry',
        });
        if (markers.length > MARKER_LIMIT) markers.splice(0, markers.length - MARKER_LIMIT);
        pushLog({
          workerId: ev.workerId,
          dayIndex: ev.dayIndex,
          minute: ev.minute,
          text: `FIRE ${ARROWS[ev.direction]} ${ev.direction} x${ev.contracts} @ ${ev.entry.toFixed(2)} (${ev.ticker} ${ev.underlying.toFixed(2)})`,
          tone: 'action',
        });
        break;
      }
      case 'TRADE_CLOSED': {
        const rt = worker(ev.workerId);
        const direction = rt.position?.direction ?? s.fx[ev.workerId].lastDirection ?? 'CALL';
        rt.earned += ev.pnl;
        rt.todayPnl += ev.pnl;
        rt.lastPnl = ev.pnl;
        rt.position = null;
        if (ev.pnl >= 0) rt.wins += 1;
        else rt.losses += 1;
        s.vault += ev.pnl;
        s.vaultSeq += 1;
        s.lastDeposit = { workerId: ev.workerId, amount: ev.pnl };
        const d = day(ev.dayIndex);
        if (d) {
          d.pnl += ev.pnl;
          d.trades += 1;
          if (ev.pnl >= 0) d.wins += 1;
          else d.losses += 1;
        }
        const f = fx(ev.workerId);
        f.closeSeq += 1;
        f.lastPnl = ev.pnl;
        const markers = touch('markers');
        markers.push({
          id: `${ev.tradeId}-out`,
          workerId: ev.workerId,
          timestamp: ev.timestamp,
          price: ev.underlying,
          direction,
          kind: 'exit',
          pnl: ev.pnl,
        });
        if (markers.length > MARKER_LIMIT) markers.splice(0, markers.length - MARKER_LIMIT);
        const { text, tone } = closeText(ev.reason, ev.pnl);
        pushLog({ workerId: ev.workerId, dayIndex: ev.dayIndex, minute: ev.minute, text, tone });
        break;
      }
      case 'THOUGHT':
        pushLog({ workerId: ev.workerId, dayIndex: ev.dayIndex, minute: ev.minute, text: ev.text, tone: ev.tone });
        break;
    }
  }
  return s;
}

/** Summary statistics derived from day/worker state. */
export function summarize(data: SimData) {
  const played = data.days.filter((d) => d.status !== 'pending');
  const green = played.filter((d) => d.pnl > 0).length;
  const best = data.days.reduce<DayRuntime | null>((b, d) => (!b || d.pnl > b.pnl ? d : b), null);
  const leaderboard = WORKERS.map((w) => ({ id: w.id, name: w.displayName, earned: data.workers[w.id].earned })).sort(
    (a, b) => b.earned - a.earned,
  );
  return {
    total: data.vault,
    daysPlayed: played.length,
    green,
    red: played.length - green,
    best,
    leaderboard,
  };
}
