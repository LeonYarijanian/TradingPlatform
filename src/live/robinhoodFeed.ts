/**
 * Robinhood feed: reads the viewer's Robinhood connector (read-only tools)
 * and keeps two towers current — the agent account the SPX bot trades and
 * the owner's own default account.
 *
 * Calls used: get_accounts, get_option_orders, get_pnl_trade_history,
 * get_index_historicals (SPX), get_equity_historicals (QQQ). No order,
 * cancel, watchlist or alert tool is ever called from this page.
 */
import { barsToPoints, type FeedId, type FeedOutput, type FeedStatus, type RawBar } from './feed';
import { isMcpError, loadCapability, type McpApi, type McpError, type WatchEvent } from './claudeRuntime';
import { LIVE_START, ROBINHOOD_SERVER, SPX_INDEX_ID, TOWERS } from './config';
import { useLive } from './liveStore';
import { etToUtcMs, previousTradingDay, toEt, type LiveCalendar } from './marketClock';
import {
  deriveRobinhood,
  parseAccounts,
  parseBars,
  parseOrderExecutions,
  parsePnlRows,
  type RhExecution,
  type RhPnlRow,
} from './robinhood';
import type { LiveFeed } from './runner';

const ORDERS_POLL_MS = 30_000;
const PNL_POLL_MS = 60_000;
const BARS_POLL_MS = 60_000;
const MAX_PAGES = 6;

/** Watch denials that must retract what the page shows. */
const AUTHZ = new Set([
  'needs_reauth',
  'server_not_connected',
  'server_not_found',
  'blocked_by_policy',
  'approval_required',
  'not_in_manifest',
]);

export function describeMcpError(e: McpError): Pick<FeedStatus, 'phase' | 'detail'> {
  switch (e.code) {
    case 'needs_reauth':
      return { phase: 'needs-auth', detail: 'reconnect Robinhood in claude.ai → Settings → Connectors' };
    case 'server_not_connected':
    case 'server_not_found':
      return { phase: 'offline', detail: 'Robinhood connector is not connected for this viewer' };
    case 'consent_required':
    case 'not_granted':
      return { phase: 'blocked', detail: 'allow Robinhood access for this page' };
    case 'selection_required':
      return { phase: 'blocked', detail: 'choose which Robinhood connection this page uses' };
    case 'blocked_by_policy':
    case 'approval_required':
    case 'not_in_manifest':
      return { phase: 'blocked', detail: e.message || 'blocked by policy' };
    default:
      return { phase: 'error', detail: e.message || e.code };
  }
}

/** Preset P&L window wide enough to reach back to the live start. */
export function pnlSpan(nowMs: number): string {
  const days = (nowMs - etToUtcMs(LIVE_START, 0)) / 86_400_000;
  if (days <= 6) return 'week';
  if (days <= 28) return 'month';
  if (days <= 88) return '3month';
  return toEt(nowMs).date.slice(0, 4) === LIVE_START.slice(0, 4) ? 'ytd' : 'all';
}

const pageCursor = (payload: unknown, key: string): string | null => {
  const p = (payload ?? {}) as Record<string, unknown>;
  const d = (p.data ?? {}) as Record<string, unknown>;
  const v = d[key] ?? p[key];
  return typeof v === 'string' && v ? v : null;
};

interface AccountData {
  executions: RhExecution[] | null;
  pnl: RhPnlRow[] | null;
  asOf: number | null;
}

export class RobinhoodFeed implements LiveFeed {
  private mcp: McpApi | null = null;
  private unwatch: Array<() => void> = [];
  private changed: () => void = () => {};
  private accounts: { bot: string | null; personal: string | null } | null = null;
  private data: Record<'bot' | 'personal', AccountData> = {
    bot: { executions: null, pnl: null, asOf: null },
    personal: { executions: null, pnl: null, asOf: null },
  };
  private bars: { SPX: RawBar[]; QQQ: RawBar[] } = { SPX: [], QQQ: [] };
  private barsFallback = { SPX: false, QQQ: false };
  private stopped = false;
  private generation = 0;

  start(_cal: LiveCalendar, changed: () => void): void {
    this.changed = changed;
    this.stopped = false;
    void this.connect();
  }

  setCalendar(): void {
    // Bars and the P&L span are anchored to the day: re-register.
    this.teardown();
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
  }

  /** Viewer gesture (e.g. after granting access): start over. */
  retry(): void {
    this.teardown();
    this.stopped = false;
    void this.connect();
  }

  private teardown(): void {
    this.generation++;
    this.unwatch.forEach((u) => u());
    this.unwatch = [];
  }

  private status(id: FeedId, s: Partial<FeedStatus>): void {
    useLive.getState().setFeed(id, s);
  }

  private both(s: Partial<FeedStatus>): void {
    this.status('rh-spx', s);
    this.status('rh-me', s);
  }

  private async connect(): Promise<void> {
    const gen = this.generation;
    this.mcp ??= await loadCapability('mcp');
    if (gen !== this.generation || this.stopped) return;
    if (!this.mcp) {
      this.both({ phase: 'offline', detail: 'open this page in claude.ai to connect Robinhood' });
      return;
    }
    this.both({ phase: 'connecting', detail: 'reading Robinhood accounts…' });
    let accounts = this.accounts;
    for (let attempt = 0; !accounts && attempt < 3; attempt++) {
      try {
        const res = await this.mcp.callTool(ROBINHOOD_SERVER, 'get_accounts', {}, { cache: { staleTime: 300_000 } });
        accounts = parseAccounts(res.payload);
      } catch (e) {
        const err = isMcpError(e) ? e : { code: 'error', message: String(e) };
        if (!err.retryable || attempt === 2) {
          this.both(describeMcpError(err));
          return;
        }
        await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 2000 * (attempt + 1)));
      }
      if (gen !== this.generation) return;
    }
    if (!accounts) return;
    this.accounts = accounts;
    if (!accounts.bot) this.status('rh-spx', { phase: 'offline', detail: 'no agent-traded Robinhood account found' });
    if (!accounts.personal) this.status('rh-me', { phase: 'offline', detail: 'no default Robinhood account found' });

    if (accounts.bot) this.watchAccount('bot', 'rh-spx', accounts.bot, gen);
    if (accounts.personal) this.watchAccount('personal', 'rh-me', accounts.personal, gen);
    this.watchBars('SPX', gen);
    this.watchBars('QQQ', gen);
  }

  private onWatchError(feed: FeedId, which: 'bot' | 'personal' | null, err: McpError): void {
    if (AUTHZ.has(err.code) || err.code === 'consent_required' || err.code === 'not_granted') {
      if (which) this.data[which] = { executions: null, pnl: null, asOf: null };
      this.changed();
    }
    const hasData = which ? this.data[which].executions !== null : true;
    // Transient failures keep the last good data on screen.
    if (!hasData || AUTHZ.has(err.code)) this.status(feed, describeMcpError(err));
  }

  private watchAccount(which: 'bot' | 'personal', feed: FeedId, account: string, gen: number): void {
    const mcp = this.mcp!;
    const acct = this.data[which];
    const fresh = (stamp: number | undefined) => {
      acct.asOf = Math.max(acct.asOf ?? 0, stamp ?? Date.now());
      if (acct.executions && acct.pnl) this.status(feed, { phase: 'live', detail: 'Robinhood · read-only', asOf: acct.asOf });
      this.changed();
    };

    const onOrders = async (ev: WatchEvent) => {
      if (gen !== this.generation) return;
      if (ev.type === 'error') return this.onWatchError(feed, which, ev.error);
      let payload = ev.result.payload;
      const execs = parseOrderExecutions(payload);
      for (let page = 1, cursor = pageCursor(payload, 'next'); cursor && page < MAX_PAGES; page++) {
        try {
          payload = (
            await mcp.callTool(ROBINHOOD_SERVER, 'get_option_orders', { account_number: account, created_at_gte: LIVE_START, cursor })
          ).payload;
        } catch {
          break;
        }
        execs.push(...parseOrderExecutions(payload));
        cursor = pageCursor(payload, 'next');
      }
      if (gen !== this.generation) return;
      acct.executions = execs.sort((a, b) => a.t - b.t);
      fresh(ev.result.cache?.storedAt);
    };

    const startMs = etToUtcMs(LIVE_START, 0);
    const span = pnlSpan(Date.now());
    const onPnl = async (ev: WatchEvent) => {
      if (gen !== this.generation) return;
      if (ev.type === 'error') return this.onWatchError(feed, which, ev.error);
      let { rows, nextCursor } = parsePnlRows(ev.result.payload);
      const all = [...rows];
      // Follow pages only while they still reach back past the live start.
      for (let page = 1; nextCursor && page < MAX_PAGES && rows.every((r) => r.t >= startMs); page++) {
        try {
          const res = await mcp.callTool(ROBINHOOD_SERVER, 'get_pnl_trade_history', { account_number: account, span, cursor: nextCursor });
          ({ rows, nextCursor } = parsePnlRows(res.payload));
        } catch {
          break;
        }
        all.push(...rows);
      }
      if (gen !== this.generation) return;
      acct.pnl = all.sort((a, b) => a.t - b.t);
      fresh(ev.result.cache?.storedAt);
    };

    this.unwatch.push(
      mcp.watchTool(
        ROBINHOOD_SERVER,
        'get_option_orders',
        { account_number: account, created_at_gte: LIVE_START },
        (ev) => void onOrders(ev),
        {
          refetchInterval: ORDERS_POLL_MS,
        },
      ),
      mcp.watchTool(ROBINHOOD_SERVER, 'get_pnl_trade_history', { account_number: account, span }, (ev) => void onPnl(ev), {
        refetchInterval: PNL_POLL_MS,
      }),
    );
  }

  private watchBars(ticker: 'SPX' | 'QQQ', gen: number): void {
    const mcp = this.mcp!;
    const today = toEt(Date.now()).date;
    // The previous session too, so the chart has something before the open.
    const from = this.barsFallback[ticker] ? today : previousTradingDay(today);
    const start_time = new Date(etToUtcMs(from, 9 * 60 + 30)).toISOString().replace('.000Z', 'Z');
    const [tool, input] =
      ticker === 'SPX'
        ? ['get_index_historicals', { instrument_ids: [SPX_INDEX_ID], start_time, interval: 'minute' }]
        : ['get_equity_historicals', { symbols: ['QQQ'], start_time, interval: 'minute' }];
    const stop = mcp.watchTool(
      ROBINHOOD_SERVER,
      tool,
      input,
      (ev) => {
        if (gen !== this.generation) return;
        if (ev.type === 'error') {
          // Too many bars for the range (e.g. across a weekend): retry with today only.
          if ((ev.error.code === 'tool_error' || ev.error.code === 'bad_request') && !this.barsFallback[ticker]) {
            this.barsFallback[ticker] = true;
            stop();
            this.watchBars(ticker, gen);
          }
          return;
        }
        this.bars[ticker] = parseBars(ev.result.payload);
        this.changed();
      },
      { refetchInterval: BARS_POLL_MS },
    );
    this.unwatch.push(stop);
  }

  derive(cal: LiveCalendar, nowMs: number): FeedOutput {
    const startMs = etToUtcMs(LIVE_START, 0);
    const spx = deriveRobinhood({
      workerId: TOWERS.spxBot,
      ticker: 'SPX',
      startMs,
      executions: this.data.bot.executions,
      pnl: this.data.bot.pnl,
      chartBars: this.bars.SPX,
      cal,
      nowMs,
    });
    const mine = deriveRobinhood({
      workerId: TOWERS.mine,
      ticker: 'QQQ',
      startMs,
      executions: this.data.personal.executions,
      pnl: this.data.personal.pnl,
      chartBars: this.bars.QQQ,
      cal,
      nowMs,
    });
    const last = (b: RawBar[]) => (b.length ? b[b.length - 1].c : 0);
    return {
      events: [...spx.events, ...mine.events],
      bars: { SPX: barsToPoints(this.bars.SPX, cal), QQQ: barsToPoints(this.bars.QQQ, cal) },
      prices: { SPX: last(this.bars.SPX), QQQ: last(this.bars.QQQ) },
      workers: { ...spx.workers, ...mine.workers },
    };
  }
}
