// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSim } from '../simulation/simulationStore';
import type { BotEvent, TradeClosedEvent, TradeExecutedEvent } from '../types/trading';
import { barsToPoints, type FeedOutput, type RawBar } from './feed';
import { etToUtcMs, LiveCalendar, sessionLength, toEt } from './marketClock';
import { deriveRobinhood, parseAccounts, parseOrderExecutions, parsePnlRows } from './robinhood';
import { LiveRunner, type LiveFeed } from './runner';
import { deriveVolx, parseDeskEvents } from './volx';

// Synthetic fixtures only — shapes mirror the connector/desk payloads.
const et = (date: string, hh: number, mm: number, ss = 0) => etToUtcMs(date, hh * 60 + mm + ss / 60);
const iso = (ms: number) => new Date(ms).toISOString();

describe('market clock', () => {
  it('round-trips ET across the November DST change', () => {
    for (const [date, h, m] of [
      ['2026-10-06', 9, 30],
      ['2026-11-02', 9, 30],
      ['2026-11-01', 0, 30],
    ] as const) {
      const ms = et(date, h, m);
      expect(toEt(ms)).toEqual({ date, minuteOfDay: h * 60 + m });
    }
    expect(new Date(et('2026-10-06', 9, 30)).toISOString()).toBe('2026-10-06T13:30:00.000Z');
    expect(new Date(et('2026-11-02', 9, 30)).toISOString()).toBe('2026-11-02T14:30:00.000Z');
  });

  it('indexes sessions from the live start, skipping weekends', () => {
    const cal = new LiveCalendar('2026-10-06', '2026-10-12');
    expect(cal.days.map((d) => d.label)).toEqual(['Tue 10/6', 'Wed 10/7', 'Thu 10/8', 'Fri 10/9', 'Mon 10/12']);
    expect(cal.dayIndexOf('2026-10-10')).toBe(3);
    expect(cal.dayIndexOf('2026-10-05')).toBe(-1);
    expect(cal.dateOf(-1)).toBe('2026-10-05');
    expect(cal.dateOf(-2)).toBe('2026-10-02');
    // Saturday 11:00 reads as Friday's session + 1 day, so charts never treat it as "in session".
    const sat = cal.locate(et('2026-10-10', 11, 0));
    expect(sat.dayIndex).toBe(3);
    expect(sat.minute).toBe(1440 + 90);
    expect(sat.timestamp).toBe(3 * 390 + 390);
    expect(cal.phase(et('2026-10-10', 11, 0))).toBe('closed');
    expect(cal.phase(et('2026-10-12', 9, 0))).toBe('pre');
    expect(cal.phase(et('2026-10-12', 15, 59))).toBe('open');
    expect(sessionLength('2026-11-27')).toBe(210);
  });
});

describe('bars', () => {
  it('keeps regular-session bars, resets VWAP daily and leaves it NaN without volume', () => {
    const cal = new LiveCalendar('2026-10-06', '2026-10-06');
    const bars: RawBar[] = [
      { t: et('2026-10-06', 9, 0), o: 1, h: 1, l: 1, c: 1, v: 10 },
      { t: et('2026-10-06', 9, 30), o: 100, h: 101, l: 99, c: 100, v: 10 },
      { t: et('2026-10-06', 9, 31), o: 100, h: 103, l: 101, c: 102, v: 30 },
    ];
    const pts = barsToPoints(bars, cal);
    expect(pts.map((p) => p.timestamp)).toEqual([0, 1]);
    expect(pts[1].vwap).toBeCloseTo((100 * 10 + 102 * 30) / 40);
    const idx = barsToPoints(
      bars.map((b) => ({ ...b, v: NaN })),
      cal,
    );
    expect(Number.isNaN(idx[0].vwap)).toBe(true);
  });
});

describe('robinhood mapping', () => {
  const cal = new LiveCalendar('2026-10-06', '2026-10-06');
  const startMs = et('2026-10-06', 0, 0);
  const leg = (side: string, effect: string, type: string, strike: string, price: string, t: number, qty = '2') => ({
    side,
    position_effect: effect,
    option_type: type,
    strike_price: strike,
    expiration_date: '2026-10-06',
    executions: [{ price, quantity: qty, timestamp: iso(t) }],
  });
  const orders = {
    data: {
      orders: [
        {
          id: 'o2',
          chain_symbol: 'XSP',
          state: 'filled',
          legs: [leg('buy', 'open', 'put', '570.0000', '0.20', et('2026-10-06', 10, 15, 6))],
        },
        {
          id: 'o1',
          chain_symbol: 'XSP',
          state: 'filled',
          legs: [leg('sell', 'open', 'put', '571.0000', '0.60', et('2026-10-06', 10, 15, 1))],
        },
        // Before the live start: ignored.
        {
          id: 'o0',
          chain_symbol: 'XSP',
          state: 'filled',
          legs: [leg('sell', 'open', 'call', '580.0000', '0.30', et('2026-10-05', 10, 0))],
        },
      ],
    },
  };

  it('picks the agent account for the bot and the default account for the owner', () => {
    const accts = parseAccounts({
      data: {
        accounts: [
          { account_number: 'A-DEFAULT', is_default: true, agentic_allowed: false, brokerage_account_type: 'individual' },
          { account_number: 'A-CUSTODIAL', is_default: false, agentic_allowed: false, brokerage_account_type: 'custodial_utma' },
          { account_number: 'A-AGENT', is_default: false, agentic_allowed: true, brokerage_account_type: 'individual' },
        ],
      },
    });
    expect(accts).toEqual({ bot: 'A-AGENT', personal: 'A-DEFAULT' });
  });

  it('fires once for a credit spread placed as two single-leg orders and holds it until expiry', () => {
    const executions = parseOrderExecutions(orders);
    const bars: RawBar[] = [{ t: et('2026-10-06', 10, 15), o: 5700, h: 5702, l: 5699, c: 5701, v: NaN }];
    const out = deriveRobinhood({
      workerId: 'qqq-trend',
      ticker: 'SPX',
      startMs,
      executions,
      pnl: [],
      chartBars: bars,
      cal,
      nowMs: et('2026-10-06', 11, 0),
    });
    const fires = out.events.filter((e) => e.ev.type === 'TRADE_EXECUTED').map((e) => e.ev as TradeExecutedEvent);
    expect(fires).toHaveLength(1);
    expect(fires[0].direction).toBe('CALL');
    expect(fires[0].contracts).toBe(2);
    expect(fires[0].underlying).toBe(5701);
    expect(fires[0].note).toBe('sold XSP 571/570 put spread x2 @ 0.40 cr');
    expect(out.workers?.['qqq-trend']?.status.status).toBe('managing');
    expect(out.workers?.['qqq-trend']?.position?.contracts).toBe(2);

    const after = deriveRobinhood({
      workerId: 'qqq-trend',
      ticker: 'SPX',
      startMs,
      executions,
      pnl: [],
      chartBars: bars,
      cal,
      nowMs: et('2026-10-06', 16, 5),
    });
    expect(after.workers?.['qqq-trend']?.position).toBeNull();
    expect(after.workers?.['qqq-trend']?.status.status).toBe('off-duty');
  });

  it('books realized P&L rows of one close as one deposit and skips rows before the start', () => {
    const { rows } = parsePnlRows({
      data: {
        trades: [
          {
            timestamp: iso(et('2026-10-06', 16, 0)),
            symbol: 'XSP 10/6 571 Put',
            side: 'expire',
            quantity: '2',
            price: '0',
            realized_gain: '120.00',
          },
          {
            timestamp: iso(et('2026-10-06', 16, 0)),
            symbol: 'XSP 10/6 570 Put',
            side: 'expire',
            quantity: '2',
            price: '0',
            realized_gain: '-40.00',
          },
          {
            timestamp: iso(et('2026-10-05', 15, 0)),
            symbol: 'XSP 10/5 575 Call',
            side: 'buy',
            quantity: '1',
            price: '0.1',
            realized_gain: '55',
          },
          {
            timestamp: iso(et('2026-10-06', 12, 0)),
            symbol: 'XSP 10/6 580 Call',
            side: 'buy',
            quantity: '1',
            price: '0.1',
            realized_gain: null,
          },
        ],
        next_cursor: null,
      },
    });
    const out = deriveRobinhood({
      workerId: 'qqq-trend',
      ticker: 'SPX',
      startMs,
      executions: [],
      pnl: rows,
      chartBars: [],
      cal,
      nowMs: et('2026-10-06', 17, 0),
    });
    const closes = out.events.filter((e) => e.ev.type === 'TRADE_CLOSED').map((e) => e.ev as TradeClosedEvent);
    expect(closes).toHaveLength(1);
    expect(closes[0].pnl).toBe(80);
    expect(closes[0].note).toBe('XSP expired');
  });
});

describe('volx mapping', () => {
  const cal = new LiveCalendar('2026-10-06', '2026-10-06');
  const startMs = et('2026-10-06', 0, 0);
  const ev = (seq: number, t: number, kind: string, symbol: string, data: Record<string, unknown> = {}, text = '') => ({
    seq,
    ts: iso(t),
    kind,
    symbol,
    strategy: '',
    text,
    data,
  });
  const armed = ev(1, et('2026-10-06', 9, 30), 'armed', 'MES', {
    buy_level: 6010,
    sell_level: 5990,
    open_px: 6000,
    prior_range: 40,
    k: 0.5,
    width: 10,
  });
  const bar = (mm: number, c: number): RawBar => ({ t: et('2026-10-06', 9, mm), o: c, h: c, l: c, c, v: 100 });

  it('charges toward the nearer breakout level', () => {
    const out = deriveVolx({
      workerId: 'qqq-og',
      startMs,
      events: parseDeskEvents([armed]),
      bars: [bar(31, 6007)],
      ready: true,
      cal,
      nowMs: et('2026-10-06', 9, 32),
    });
    const st = out.workers?.['qqq-og']?.status;
    expect(st?.status).toBe('charging');
    expect(st?.direction).toBe('CALL');
    expect(st?.charge).toBe(70);
    expect(st?.atrAway).toBeCloseTo(3);
  });

  it('fires on the entry fill, books the close and cools down for the session', () => {
    const events = parseDeskEvents([
      armed,
      ev(2, et('2026-10-06', 9, 40), 'order_filled', 'MES', { side: 'SELL', price: 5989.75, qty: 1 }),
      ev(3, et('2026-10-06', 10, 5), 'position_closed', 'MES', { pnl: 98.76 }),
      // Overnight member: a fill on an instrument without a chart gets no marker.
      ev(4, et('2026-10-06', 15, 59), 'order_filled', 'MNQ', { side: 'BUY', price: 25000, qty: 1 }),
    ]);
    const mid = deriveVolx({
      workerId: 'qqq-og',
      startMs,
      events: events.slice(0, 2),
      bars: [],
      ready: true,
      cal,
      nowMs: et('2026-10-06', 9, 45),
    });
    expect(mid.workers?.['qqq-og']?.status.status).toBe('managing');
    expect(mid.workers?.['qqq-og']?.position?.direction).toBe('PUT');

    const out = deriveVolx({
      workerId: 'qqq-og',
      startMs,
      events: events.slice(0, 3),
      bars: [],
      ready: true,
      cal,
      nowMs: et('2026-10-06', 11, 0),
    });
    const kinds = out.events.map((e) => e.ev.type);
    expect(kinds).toEqual(['THOUGHT', 'TRADE_EXECUTED', 'TRADE_CLOSED']);
    expect((out.events[2].ev as TradeClosedEvent).pnl).toBe(98.76);
    expect(out.workers?.['qqq-og']?.status.status).toBe('cooldown');

    const night = deriveVolx({ workerId: 'qqq-og', startMs, events, bars: [], ready: true, cal, nowMs: et('2026-10-06', 18, 0) });
    const mnq = night.events.find((e) => e.ev.type === 'TRADE_EXECUTED' && (e.ev as TradeExecutedEvent).note?.includes('MNQ'));
    expect((mnq?.ev as TradeExecutedEvent).underlying).toBe(0);
    expect(night.workers?.['qqq-og']?.status.status).toBe('managing');
  });
});

describe('live runner', () => {
  afterEach(() => vi.useRealTimers());

  it('ingests each event once and tops up a deposit that grows between polls', () => {
    const now = et('2026-10-06', 11, 0);
    let pnl = 50;
    const closed = (): BotEvent => ({
      type: 'TRADE_CLOSED',
      workerId: 'qqq-trend',
      tradeId: 'k',
      pnl,
      exit: 0,
      reason: 'target',
      dayIndex: 0,
      minute: 60,
      timestamp: 60,
      underlying: 0,
      note: 'closed XSP',
    });
    const feed: LiveFeed = {
      start: () => {},
      stop: () => {},
      derive: (): FeedOutput => ({
        events: [
          { key: 'k', ts: 60, ev: closed() },
          { key: 't', ts: 59, ev: { type: 'THOUGHT', workerId: 'qqq-trend', dayIndex: 0, minute: 59, text: 'hello', tone: 'info' } },
        ],
      }),
    };
    vi.useFakeTimers();
    const runner = new LiveRunner([feed], () => now);
    runner.start();
    expect(useSim.getState().vault).toBe(50);
    runner.flush();
    expect(useSim.getState().vault).toBe(50);
    expect(useSim.getState().thoughts['qqq-trend'].filter((t) => t.text === 'hello')).toHaveLength(1);
    pnl = 80;
    runner.flush();
    expect(useSim.getState().vault).toBe(80);
    expect(useSim.getState().days[0].pnl).toBe(80);
    // Session for today opened (11:00 ET).
    expect(useSim.getState().days[0].status).toBe('active');
    runner.stop();
  });
});
