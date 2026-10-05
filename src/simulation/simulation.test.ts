import { describe, expect, it } from 'vitest';
import { DAY_PNL_TARGETS, RUN_TOTAL_TARGET, SESSION_MINUTES, TRADING_DAY_COUNT, WORKER_PNL_TARGETS } from '../data/demoRun';
import { WORKERS } from '../data/workers';
import type { BotEvent, WorkerId } from '../types/trading';
import { buildTradingCalendar, formatSessionTime } from './calendar';
import { buildDemoSchedule } from './eventScheduler';
import { balanceMatrix, formatCompact, formatMoney, splitAmount } from './pnl';
import { createInitialSimData, reduceEvents, summarize } from './reducer';
import { createRng } from './rng';
import { SimulationEngine } from './SimulationEngine';

const schedule = buildDemoSchedule();

describe('pnl helpers', () => {
  it('formats money with sign and thousands separators', () => {
    expect(formatMoney(72074)).toBe('+$72,074');
    expect(formatMoney(-84)).toBe('−$84');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(1234, { sign: false })).toBe('$1,234');
    expect(formatCompact(4177)).toBe('+4.2k');
    expect(formatCompact(10930)).toBe('+11k');
  });

  it('balances an integer matrix to exact row and column totals', () => {
    const rng = createRng(7);
    const seed = Array.from({ length: 6 }, (_, i) => Array.from({ length: 4 }, (_, j) => (i === 0 && j === 3 ? 0 : rng() + 0.1)));
    const rows = [100, 250, 75, 300, 125, 150];
    const cols = [400, 200, 250, 150];
    const m = balanceMatrix(seed, rows, cols);
    m.forEach((r, i) => expect(r.reduce((a, b) => a + b, 0)).toBe(rows[i]));
    cols.forEach((c, j) => expect(m.reduce((a, r) => a + r[j], 0)).toBe(c));
    expect(m[0][3]).toBe(0);
    m.flat().forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  it('splits amounts exactly', () => {
    const parts = splitAmount(1000, 4, createRng(3), 25);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    parts.forEach((p) => expect(p).toBeGreaterThanOrEqual(25));
  });
});

describe('calendar', () => {
  it('builds 23 trading days skipping weekends and Labor Day', () => {
    const cal = buildTradingCalendar('2026-09-04', 23);
    expect(cal).toHaveLength(23);
    expect(cal[0].label).toBe('Fri 9/4');
    expect(cal[1].label).toBe('Tue 9/8');
    expect(cal.find((d) => d.date === '2026-09-29')?.label).toBe('Tue 9/29');
    expect(cal.some((d) => d.date === '2026-09-07')).toBe(false);
  });

  it('formats session minutes as ET clock', () => {
    expect(formatSessionTime(0)).toBe('9:30');
    expect(formatSessionTime(13)).toBe('9:43');
    expect(formatSessionTime(390)).toBe('4:00');
  });
});

describe('demo schedule', () => {
  it('is deterministic', () => {
    const again = buildDemoSchedule();
    expect(again.trades.map((t) => [t.id, t.pnl, t.entryMinute])).toEqual(schedule.trades.map((t) => [t.id, t.pnl, t.entryMinute]));
  });

  it('hits the per-worker and per-day targets exactly', () => {
    const byWorker: Record<string, number> = {};
    const byDay = new Array(TRADING_DAY_COUNT).fill(0);
    for (const t of schedule.trades) {
      byWorker[t.workerId] = (byWorker[t.workerId] ?? 0) + t.pnl;
      byDay[t.dayIndex] += t.pnl;
    }
    for (const w of WORKERS) expect(byWorker[w.id]).toBe(WORKER_PNL_TARGETS[w.id]);
    expect(byDay).toEqual([...DAY_PNL_TARGETS]);
    expect(byDay.reduce((a, b) => a + b, 0)).toBe(RUN_TOTAL_TARGET);
    byDay.forEach((d) => expect(d).toBeGreaterThan(0));
  });

  it('has the best day on Tue 9/29 at +$10,930 and a stronger last third', () => {
    const best = DAY_PNL_TARGETS.indexOf(Math.max(...DAY_PNL_TARGETS));
    expect(schedule.calendar[best].label).toBe('Tue 9/29');
    expect(DAY_PNL_TARGETS[best]).toBe(10930);
    const third = Math.floor(TRADING_DAY_COUNT / 3);
    const first = DAY_PNL_TARGETS.slice(0, third).reduce((a, b) => a + b, 0);
    const last = DAY_PNL_TARGETS.slice(-third).reduce((a, b) => a + b, 0);
    expect(last).toBeGreaterThan(first * 1.25);
  });

  it('keeps every worker timeline non-overlapping and inside the session', () => {
    for (const w of WORKERS) {
      const segs = schedule.segments[w.id];
      for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end - 1e-9);
      for (const s of segs) {
        const day = Math.floor(s.start / SESSION_MINUTES);
        expect(s.end).toBeLessThanOrEqual((day + 1) * SESSION_MINUTES);
      }
    }
  });

  it('aligns winning trade direction with the underlying move', () => {
    for (const t of schedule.trades) {
      const series = schedule.market.tickers[t.ticker];
      const base = t.dayIndex * SESSION_MINUTES;
      const move = series.price[base + t.exitMinute] - series.price[base + t.entryMinute];
      const favorable = t.direction === 'CALL' ? move >= 0 : move <= 0;
      expect(favorable).toBe(t.pnl >= 0);
    }
  });

  it('keeps IWM flat until it starts trading', () => {
    const iwmEarly = schedule.trades.filter((t) => t.workerId === 'iwm' && t.dayIndex < 10);
    expect(iwmEarly).toHaveLength(0);
  });
});

function runAll(engine: SimulationEngine, step: number) {
  let state = reduceEvents(createInitialSimData(), engine.reset());
  const seen: BotEvent['type'][] = [];
  let lastTime = -1;
  while (!engine.finished) {
    const events = engine.advance(step);
    for (const e of events) {
      seen.push(e.type);
      if (e.type === 'TRADE_EXECUTED' || e.type === 'TRADE_CLOSED') {
        expect(e.timestamp).toBeGreaterThanOrEqual(lastTime);
        lastTime = e.timestamp;
      }
    }
    state = reduceEvents(state, events);
  }
  return { state, seen };
}

describe('simulation engine', () => {
  it('replays the whole run into the reducer and lands on +$72,074', () => {
    const engine = new SimulationEngine(schedule);
    const { state, seen } = runAll(engine, 3.7);
    expect(state.vault).toBe(RUN_TOTAL_TARGET);
    for (const w of WORKERS) expect(state.workers[w.id].earned).toBe(WORKER_PNL_TARGETS[w.id]);
    expect(state.days.map((d) => d.pnl)).toEqual([...DAY_PNL_TARGETS]);
    expect(state.days.every((d) => d.status === 'done')).toBe(true);
    expect(state.clock.finished).toBe(true);
    for (const w of WORKERS) expect(state.workers[w.id].status).toBe('off-duty');
    expect(seen).toContain('BOT_STATUS');
    expect(seen).toContain('MARKET_BAR');
    const summary = summarize(state);
    expect(summary.green).toBe(23);
    expect(summary.best?.label).toBe('Tue 9/29');
    expect(summary.leaderboard.slice(0, 3).map((l) => l.name)).toEqual(['QQQ OG', 'SPY', 'QQQ TREND']);
  });

  it('produces identical results regardless of step size', () => {
    const a = runAll(new SimulationEngine(schedule), 0.9).state;
    const b = runAll(new SimulationEngine(schedule), 41).state;
    expect(a.vault).toBe(b.vault);
    expect(a.days.map((d) => d.pnl)).toEqual(b.days.map((d) => d.pnl));
  });

  it('walks a worker through charge → ready → fire → manage → trail → cooldown', () => {
    const engine = new SimulationEngine(schedule);
    engine.reset();
    const trade = schedule.trades.find((t) => t.workerId === 'qqq-trend' && t.exitMinute - t.entryMinute >= 10)!;
    const base = trade.dayIndex * SESSION_MINUTES;
    const id: WorkerId = trade.workerId;
    const at = (m: number) => engine.snapshot(id, base + m);
    const mid = (trade.chargeStartMinute + trade.entryMinute) / 2;
    expect(at(mid).status).toBe('charging');
    expect(at(mid).direction).toBe(trade.direction);
    expect(at(mid).charge).toBeGreaterThan(5);
    expect(at(mid).charge).toBeLessThan(95);
    expect(at(trade.entryMinute - 0.5).status).toBe('ready');
    expect(at(trade.entryMinute + 0.2).status).toBe('firing');
    expect(at(trade.entryMinute + 2).status).toBe('managing');
    expect(at(trade.exitMinute - 0.5).status).toBe('trailing');
    expect(at(trade.exitMinute + 0.5).status).toBe('cooldown');
  });

  it('charge rises monotonically-ish toward 100 while charging', () => {
    const engine = new SimulationEngine(schedule);
    engine.reset();
    const trade = schedule.trades.find((t) => t.workerId === 'spy')!;
    const base = trade.dayIndex * SESSION_MINUTES;
    const c0 = engine.snapshot('spy', base + trade.chargeStartMinute + 0.5).charge;
    const c1 = engine.snapshot('spy', base + trade.entryMinute - 0.2).charge;
    expect(c1).toBeGreaterThan(c0 + 50);
  });

  it('injects manual CALL/PUT trades that flow through to the vault', () => {
    const engine = new SimulationEngine(schedule);
    let state = reduceEvents(createInitialSimData(), engine.reset());
    state = reduceEvents(state, engine.advance(30));
    const before = state.vault;
    engine.inject('qqq', 'PUT');
    let fired = false;
    let closed = 0;
    for (let i = 0; i < 40; i++) {
      const events = engine.advance(1);
      for (const e of events) {
        if (e.type === 'TRADE_EXECUTED' && e.tradeId.startsWith('manual')) fired = true;
        if (e.type === 'TRADE_CLOSED' && e.tradeId.startsWith('manual')) closed = e.pnl;
      }
      state = reduceEvents(state, events);
    }
    expect(fired).toBe(true);
    expect(closed).not.toBe(0);
    const scheduled = schedule.trades
      .filter((t) => t.dayIndex === 0 && t.exitMinute > 30 && t.exitMinute <= 70)
      .reduce((a, t) => a + t.pnl, 0);
    expect(state.vault).toBe(before + scheduled + closed);
  });

  it('resets cleanly for replay', () => {
    const engine = new SimulationEngine(schedule);
    let state = reduceEvents(createInitialSimData(), engine.reset());
    state = reduceEvents(state, engine.advance(2000));
    expect(state.vault).toBeGreaterThan(0);
    state = reduceEvents(state, engine.reset());
    expect(state.vault).toBe(0);
    expect(state.ticker).toHaveLength(0);
    expect(state.days.every((d) => d.pnl === 0)).toBe(true);
    expect(engine.currentTime).toBe(0);
  });

  it('end-day jumps to the next session', () => {
    const engine = new SimulationEngine(schedule);
    let state = reduceEvents(createInitialSimData(), engine.reset());
    state = reduceEvents(state, engine.advance(50));
    state = reduceEvents(state, engine.endDay());
    expect(state.days[0].status).toBe('done');
    expect(state.days[0].pnl).toBe(DAY_PNL_TARGETS[0]);
    expect(state.clock.dayIndex).toBe(1);
  });
});

describe('reducer', () => {
  it('does not mutate the previous state', () => {
    const engine = new SimulationEngine(schedule);
    const s0 = reduceEvents(createInitialSimData(), engine.reset());
    const snapshot = JSON.stringify(s0);
    reduceEvents(s0, engine.advance(120));
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('consumes live-style events from an external backend', () => {
    let s = reduceEvents(createInitialSimData(), [{ type: 'RUN_INIT', days: [{ date: '2026-09-14', label: 'Mon 9/14' }] }]);
    s = reduceEvents(s, [
      { type: 'SESSION', dayIndex: 0, phase: 'open' },
      { type: 'BOT_STATUS', workerId: 'qqq-trend', status: 'charging', direction: 'CALL', charge: 68 },
      { type: 'TRADE_EXECUTED', workerId: 'qqq-og', tradeId: 'x1', ticker: 'QQQ', direction: 'CALL', contracts: 7, entry: 3.53, underlying: 715.8, dayIndex: 0, minute: 106, timestamp: 106 },
      { type: 'TRADE_CLOSED', workerId: 'qqq-og', tradeId: 'x1', pnl: 161, exit: 3.76, reason: 'trail', dayIndex: 0, minute: 113, timestamp: 113, underlying: 716.1 },
    ]);
    expect(s.workers['qqq-trend'].charge).toBe(68);
    expect(s.workers['qqq-og'].earned).toBe(161);
    expect(s.vault).toBe(161);
    expect(s.days[0].pnl).toBe(161);
    expect(s.fx['qqq-og'].fireSeq).toBe(1);
    expect(s.thoughts['qqq-og'][0].text).toBe('🔥 rode the trail +$161');
    expect(s.thoughts['qqq-og'][1].text).toBe('FIRE ▲ CALL x7 @ 3.53 (QQQ 715.80)');
  });
});
