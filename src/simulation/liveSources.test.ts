import { describe, expect, it } from 'vitest';
import { parseMessage } from './liveSources';
import { createInitialSimData, reduceEvents } from './reducer';

describe('live event parsing', () => {
  it('accepts the documented backend payloads', () => {
    const events = parseMessage(
      JSON.stringify([
        { type: 'BOT_STATUS', workerId: 'qqq-trend', status: 'charging', direction: 'CALL', charge: 68 },
        { type: 'TRADE_EXECUTED', workerId: 'qqq-og', ticker: 'QQQ', direction: 'CALL', contracts: 7, entry: 3.53, underlying: 715.8 },
        { type: 'TRADE_CLOSED', workerId: 'qqq-og', pnl: 161 },
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(['BOT_STATUS', 'TRADE_EXECUTED', 'TRADE_CLOSED']);
    let s = reduceEvents(createInitialSimData(), [{ type: 'RUN_INIT', days: [{ date: '2026-09-14', label: 'Mon 9/14' }] }]);
    s = reduceEvents(s, events);
    expect(s.workers['qqq-trend'].status).toBe('charging');
    expect(s.workers['qqq-trend'].charge).toBe(68);
    expect(s.workers['qqq-og'].earned).toBe(161);
    expect(s.vault).toBe(161);
  });

  it('accepts snake_case keys from a Python bot', () => {
    const [e] = parseMessage('{"type":"trade_executed","worker_id":"spy","ticker":"spy","direction":"put","contracts":"5","entry_price":2.4,"underlying_price":760.1}');
    expect(e).toMatchObject({ type: 'TRADE_EXECUTED', workerId: 'spy', ticker: 'SPY', direction: 'PUT', contracts: 5, entry: 2.4, underlying: 760.1 });
  });

  it('drops malformed or unknown messages instead of throwing', () => {
    expect(parseMessage('not json')).toEqual([]);
    expect(parseMessage('{"type":"BOT_STATUS","workerId":"nope","status":"charging"}')).toEqual([]);
    expect(parseMessage('{"type":"BOT_STATUS","workerId":"iwm","status":"dancing"}')).toEqual([]);
    expect(parseMessage('{"type":"SOMETHING_ELSE"}')).toEqual([]);
  });
});
