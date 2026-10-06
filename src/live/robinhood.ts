/**
 * Robinhood → city events (pure).
 *
 * Inputs are the JSON payloads of read-only Robinhood connector tools
 * (get_accounts, get_option_orders, get_pnl_trade_history,
 * get_equity_historicals, get_index_historicals). Nothing here can trade.
 *
 * - Opening fills become FIRE events. Legs filled within a short window are
 *   one trade, so a credit spread placed as two single-leg orders seconds
 *   apart fires once. Selling a put (or buying a call) reads bullish (CALL
 *   colours); selling a call / buying a put reads bearish (PUT colours).
 * - Realized P&L comes from the P&L hub rows (closes and expirations), so the
 *   vault holds exactly what Robinhood booked.
 * - The open position is the net of legs opened since the live start that
 *   have not been closed or expired.
 */
import type { OpenPosition, OptionDirection, Ticker, WorkerId } from '../types/trading';
import { arr, clip, num, obj, priceAt, str, type FeedOutput, type KeyedEvent, type RawBar, type WorkerLiveState } from './feed';
import { sessionLength, toEt, type LiveCalendar } from './marketClock';

/** Legs filled this close together belong to one trade. */
export const GROUP_WINDOW_MS = 90_000;

export interface RhAccounts {
  /** The agent-traded account the SPX bot uses. */
  bot: string | null;
  /** The owner's own default account. */
  personal: string | null;
}

export function parseAccounts(payload: unknown): RhAccounts {
  const accounts = arr(obj(obj(payload).data).accounts ?? obj(payload).accounts).map(obj);
  const active = accounts.filter((a) => str(a.state) !== 'deactivated' && a.deactivated !== true);
  const bot = active.find((a) => a.agentic_allowed === true);
  const personal =
    active.find((a) => a.is_default === true && a !== bot) ??
    active.find((a) => a !== bot && str(a.brokerage_account_type) === 'individual');
  return { bot: bot ? str(bot.account_number) || null : null, personal: personal ? str(personal.account_number) || null : null };
}

export interface RhExecution {
  orderId: string;
  chain: string;
  side: 'buy' | 'sell';
  effect: 'open' | 'close';
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  price: number;
  qty: number;
  t: number;
}

/** get_option_orders payload → individual leg executions, oldest first. */
export function parseOrderExecutions(payload: unknown): RhExecution[] {
  const orders = arr(obj(obj(payload).data).orders ?? obj(payload).orders).map(obj);
  const out: RhExecution[] = [];
  for (const o of orders) {
    const orderId = str(o.id);
    const chain = str(o.chain_symbol).toUpperCase();
    for (const legRaw of arr(o.legs)) {
      const leg = obj(legRaw);
      const side = str(leg.side) === 'sell' ? 'sell' : 'buy';
      const effect = str(leg.position_effect) === 'close' ? 'close' : 'open';
      const type = str(leg.option_type) === 'put' ? 'put' : 'call';
      const strike = num(leg.strike_price);
      const expiration = str(leg.expiration_date);
      for (const exRaw of arr(leg.executions)) {
        const ex = obj(exRaw);
        const t = Date.parse(str(ex.timestamp));
        const qty = num(ex.quantity);
        const price = num(ex.price);
        if (!Number.isFinite(t) || !(qty > 0) || !(price >= 0)) continue;
        out.push({ orderId, chain, side, effect, type, strike, expiration, price, qty, t });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface RhPnlRow {
  t: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  gain: number;
}

export function parsePnlRows(payload: unknown): { rows: RhPnlRow[]; nextCursor: string | null } {
  const data = obj(obj(payload).data ?? payload);
  const rows: RhPnlRow[] = [];
  for (const r of arr(data.trades).map(obj)) {
    const t = Date.parse(str(r.timestamp));
    const gain = num(r.realized_gain);
    if (!Number.isFinite(t) || !Number.isFinite(gain)) continue;
    rows.push({ t, symbol: str(r.symbol), side: str(r.side), quantity: num(r.quantity, 0), price: num(r.price, 0), gain });
  }
  rows.sort((a, b) => a.t - b.t);
  return { rows, nextCursor: str(data.next_cursor) || null };
}

/** get_equity_historicals / get_index_historicals payload → regular-session bars. */
export function parseBars(payload: unknown): RawBar[] {
  const out: RawBar[] = [];
  for (const res of arr(obj(obj(payload).data).results ?? obj(payload).results).map(obj)) {
    for (const b of arr(res.bars).map(obj)) {
      if (b.interpolated === true) continue;
      const session = str(b.session);
      if (session && session !== 'reg') continue;
      const t = Date.parse(str(b.begins_at));
      const c = num(b.close_price ?? b.close_value);
      if (!Number.isFinite(t) || !(c > 0)) continue;
      out.push({
        t,
        o: num(b.open_price ?? b.open_value, c),
        h: num(b.high_price ?? b.high_value, c),
        l: num(b.low_price ?? b.low_value, c),
        c,
        v: num(b.volume, NaN),
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Option roots that trade off each chart. */
const CHART_ROOTS: Partial<Record<Ticker, readonly string[]>> = {
  SPX: ['SPX', 'SPXW', 'XSP'],
  QQQ: ['QQQ'],
};

export const rootOf = (symbol: string) =>
  symbol
    .trim()
    .toUpperCase()
    .split(/[\s$0-9]/)[0] ?? '';

interface ExecGroup {
  execs: RhExecution[];
  t: number;
}

function groupExecutions(execs: readonly RhExecution[]): ExecGroup[] {
  const groups: ExecGroup[] = [];
  const open = new Map<string, ExecGroup>();
  for (const e of execs) {
    const g = open.get(e.chain);
    if (g && e.t - g.t <= GROUP_WINDOW_MS) g.execs.push(e);
    else {
      const ng = { execs: [e], t: e.t };
      open.set(e.chain, ng);
      groups.push(ng);
    }
  }
  return groups;
}

const legId = (e: RhExecution) => `${e.chain}|${e.expiration}|${e.strike}|${e.type}`;

interface LegSum {
  sample: RhExecution;
  qty: number;
  notional: number;
}

function sumLegs(execs: readonly RhExecution[]): LegSum[] {
  const legs = new Map<string, LegSum>();
  for (const e of execs) {
    const id = `${legId(e)}|${e.side}`;
    const l = legs.get(id) ?? { sample: e, qty: 0, notional: 0 };
    l.qty += e.qty;
    l.notional += e.qty * e.price;
    legs.set(id, l);
  }
  return [...legs.values()];
}

/** Bullish (CALL colours) or bearish (PUT colours) reading of a set of legs. */
function biasOf(legs: ReadonlyArray<{ type: 'call' | 'put'; side: 'buy' | 'sell' }>): OptionDirection {
  const shorts = legs.filter((l) => l.side === 'sell');
  const lead = shorts[0] ?? legs[0];
  if (!lead) return 'CALL';
  const bullish = lead.side === 'sell' ? lead.type === 'put' : lead.type === 'call';
  return bullish ? 'CALL' : 'PUT';
}

const fmtStrike = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtExp = (iso: string) => {
  const [, m, d] = iso.split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
};

/** "sold XSP 571/570 put spread x2 @ 0.42 cr", "bought TSLA 250C 10/9 x1 @ 3.20". */
export function describeLegs(verb: 'open' | 'close', legs: readonly LegSum[]): { text: string; contracts: number; net: number } {
  const contracts = Math.max(...legs.map((l) => l.qty));
  // Per-share net: credits positive.
  const net = legs.reduce((s, l) => s + (l.sample.side === 'sell' ? 1 : -1) * (l.notional / l.qty), 0);
  const chain = legs[0].sample.chain;
  const priceText = (n: number) => (legs.length > 1 ? `${Math.abs(n).toFixed(2)} ${n >= 0 ? 'cr' : 'db'}` : Math.abs(n).toFixed(2));
  if (legs.length === 1) {
    const l = legs[0].sample;
    const action = verb === 'close' ? 'closed' : l.side === 'sell' ? 'sold' : 'bought';
    return {
      text: `${action} ${chain} ${fmtStrike(l.strike)}${l.type === 'call' ? 'C' : 'P'} ${fmtExp(l.expiration)} x${contracts} @ ${priceText(net)}`,
      contracts,
      net,
    };
  }
  const short = legs.find((l) => l.sample.side === 'sell');
  const long = legs.find((l) => l.sample.side === 'buy');
  if (legs.length === 2 && short && long && short.sample.type === long.sample.type) {
    const kind = short.sample.type === 'put' ? 'put' : 'call';
    const action = verb === 'open' ? (net >= 0 ? 'sold' : 'bought') : 'closed';
    const strikes = verb === 'open' && net >= 0 ? [short, long] : [long, short];
    return {
      text: `${action} ${chain} ${strikes.map((l) => fmtStrike(l.sample.strike)).join('/')} ${kind} spread x${contracts} @ ${priceText(net)}`,
      contracts,
      net,
    };
  }
  return { text: `${verb === 'open' ? 'opened' : 'closed'} ${chain} ${legs.length}-leg x${contracts} @ ${priceText(net)}`, contracts, net };
}

function expired(expiration: string, nowMs: number): boolean {
  if (!expiration) return false;
  const now = toEt(nowMs);
  if (now.date !== expiration) return now.date > expiration;
  return now.minuteOfDay >= 9 * 60 + 30 + sessionLength(expiration);
}

export interface RhDeriveInput {
  workerId: WorkerId;
  /** The tower's chart instrument. */
  ticker: Ticker;
  /** Epoch ms of the live start (ET midnight of the start date). */
  startMs: number;
  executions: readonly RhExecution[] | null;
  pnl: readonly RhPnlRow[] | null;
  chartBars: readonly RawBar[];
  cal: LiveCalendar;
  nowMs: number;
}

export function deriveRobinhood(input: RhDeriveInput): FeedOutput {
  const { workerId, ticker, startMs, cal, nowMs, chartBars } = input;
  const roots = CHART_ROOTS[ticker] ?? [ticker];
  const onChart = (root: string, t: number) => (roots.includes(root) ? priceAt(chartBars, t) : 0);
  const events: KeyedEvent[] = [];
  const execs = (input.executions ?? []).filter((e) => e.t >= startMs);

  let lastOpen: { key: string; t: number; net: number; ts: number } | null = null;
  for (const group of groupExecutions(execs.filter((e) => e.effect === 'open'))) {
    const legs = sumLegs(group.execs);
    const { text, contracts, net } = describeLegs('open', legs);
    const loc = cal.locate(group.t);
    const key = `rh:${workerId}:open:${group.execs[0].orderId}:${group.t}`;
    events.push({
      key,
      ts: loc.timestamp,
      ev: {
        type: 'TRADE_EXECUTED',
        workerId,
        tradeId: key,
        ticker,
        direction: biasOf(legs.map((l) => l.sample)),
        contracts,
        entry: Math.abs(net),
        underlying: onChart(group.execs[0].chain, group.t),
        dayIndex: loc.dayIndex,
        minute: loc.minute,
        timestamp: loc.timestamp,
        note: text,
      },
    });
    lastOpen = { key, t: group.t, net, ts: loc.timestamp };
  }

  for (const group of groupExecutions(execs.filter((e) => e.effect === 'close'))) {
    const { text } = describeLegs('close', sumLegs(group.execs));
    const loc = cal.locate(group.t);
    events.push({
      key: `rh:${workerId}:close:${group.execs[0].orderId}:${group.t}`,
      ts: loc.timestamp,
      ev: { type: 'THOUGHT', workerId, dayIndex: loc.dayIndex, minute: loc.minute, text: clip(text), tone: 'info' },
    });
  }

  // Realized P&L, one deposit per close (legs booked together are one deposit).
  const rows = (input.pnl ?? []).filter((r) => r.t >= startMs);
  const pnlGroups: Array<{ rows: RhPnlRow[]; t: number; root: string }> = [];
  for (const r of rows) {
    const root = rootOf(r.symbol);
    const g = pnlGroups.find((x) => x.root === root && r.t - x.t <= GROUP_WINDOW_MS && r.t >= x.t);
    if (g) g.rows.push(r);
    else pnlGroups.push({ rows: [r], t: r.t, root });
  }
  for (const g of pnlGroups) {
    const pnl = Math.round(g.rows.reduce((s, r) => s + r.gain, 0) * 100) / 100;
    const expiredAll = g.rows.every((r) => r.price === 0);
    const loc = cal.locate(g.t);
    const key = `rh:${workerId}:pnl:${g.t}:${g.root}`;
    events.push({
      key,
      ts: loc.timestamp + 0.1,
      ev: {
        type: 'TRADE_CLOSED',
        workerId,
        tradeId: key,
        pnl,
        exit: g.rows[0].price,
        reason: expiredAll ? 'time' : pnl >= 0 ? 'target' : 'stop',
        dayIndex: loc.dayIndex,
        minute: loc.minute,
        timestamp: loc.timestamp,
        underlying: onChart(g.root, g.t),
        note: expiredAll ? `${g.root} expired` : `closed ${g.root}`,
      },
    });
  }

  // Open position: legs opened since the start, net of closes, not yet expired.
  const net = new Map<string, { sample: RhExecution; opened: number; closed: number }>();
  for (const e of execs) {
    const id = legId(e);
    const l = net.get(id) ?? { sample: e, opened: 0, closed: 0 };
    if (e.effect === 'open') {
      if (l.opened === 0) l.sample = e;
      l.opened += e.qty;
    } else l.closed += e.qty;
    net.set(id, l);
  }
  const live = [...net.values()]
    .filter((l) => l.opened > l.closed && !expired(l.sample.expiration, nowMs))
    .map((l) => ({ ...l.sample, qty: l.opened - l.closed }));
  let position: OpenPosition | null = null;
  if (live.length) {
    position = {
      tradeId: lastOpen?.key ?? `rh:${workerId}:position`,
      direction: biasOf(live),
      contracts: Math.max(...live.map((l) => l.qty)),
      entryPrice: Math.abs(lastOpen?.net ?? 0),
      underlyingPrice: 0,
      openedAt: lastOpen?.ts ?? 0,
    };
  }

  const ready = input.executions !== null;
  const phase = cal.phase(nowMs);
  const status: WorkerLiveState['status'] = position
    ? { status: 'managing', direction: position.direction, charge: 0 }
    : { status: ready && phase === 'open' ? 'watching' : 'off-duty', direction: null, charge: 0 };
  return { events, workers: { [workerId]: { status, position } } };
}
