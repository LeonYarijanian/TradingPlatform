/**
 * VolX feed.
 *
 * On the desk PC (Claude desktop app with the local `volxdesk` bridge) the
 * page polls the desk's event log directly and — when the viewer is the
 * page's owner — saves a compact copy to the artifact database. Everywhere
 * else (phone, browser) the tower renders that last synced copy.
 *
 * Database layout (owner-written, everyone with access reads):
 *   volx/state            { v, savedAt, lastEventMs, lastPrice, bars: [[t,o,h,l,c,v], …] }
 *   volx_days/<YYYY-MM-DD> { v, date, events: [[ts, kind, symbol, text, data, seq], …] }
 */
import { arr, num, obj, stableJson, str, type FeedOutput, type FeedStatus, type RawBar } from './feed';
import { isMcpError, loadCapability, type DbApi, type McpApi } from './claudeRuntime';
import { DESK_SERVER, LIVE_START, TOWERS } from './config';
import { useLive } from './liveStore';
import { etToUtcMs, OPEN_MINUTE_OF_DAY, previousTradingDay, toEt, type LiveCalendar } from './marketClock';
import type { LiveFeed } from './runner';
import { deriveVolx, deskEventKey, mergeBars, parseDeskBars, parseDeskEvents, type DeskEvent } from './volx';

const POLL_MS = 10_000;
const SYNC_DEBOUNCE_MS = 20_000;
/** A synced copy older than this no longer drives the live charge animation. */
const STALE_SYNC_MS = 10 * 60_000;
/** Codes that mean "no desk bridge on this device" — don't retry unattended. */
const NO_BRIDGE = new Set([
  'server_not_connected',
  'server_not_found',
  'not_in_manifest',
  'not_granted',
  'capability_disabled',
  'capability_removed',
  'blocked_by_policy',
  'cancelled',
]);

type Mode = 'starting' | 'bridge' | 'synced';

/** Desk events → compact rows for the database (text trimmed, empty fields dropped). */
export function packEvents(events: readonly DeskEvent[]): unknown[] {
  return events.map((e) => [e.ts, e.kind, e.symbol, e.text.slice(0, 240), e.data, e.seq]);
}

export function unpackEvents(rows: unknown): DeskEvent[] {
  return parseDeskEvents(
    arr(rows).map((r) => {
      const a = arr(r);
      return { ts: a[0], kind: a[1], symbol: a[2], text: a[3], data: a[4], seq: a[5] };
    }),
  );
}

const isRth = (t: number) => {
  const m = toEt(t).minuteOfDay - OPEN_MINUTE_OF_DAY;
  return m >= 0 && m < 390;
};

export class VolxFeed implements LiveFeed {
  private mcp: McpApi | null = null;
  private db: DbApi | null = null;
  private owner = false;
  private mode: Mode = 'starting';
  private events = new Map<string, DeskEvent>();
  private bars = new Map<number, RawBar>();
  private lastPrice: { t: number; c: number } | null = null;
  private epoch = '';
  private cursor = 0;
  private ready = false;
  private timer = 0;
  private changed: () => void = () => {};
  private unsubs: Array<() => void> = [];
  private stopped = false;
  private syncTimer = 0;
  private syncing = false;
  private written = new Map<string, string>();
  private lastEventMs: number | null = null;
  /** savedAt of the synced copy being shown (synced mode only). */
  private syncedAt = 0;

  start(_cal: LiveCalendar, changed: () => void): void {
    this.changed = changed;
    this.stopped = false;
    void this.boot();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.syncTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  /** Viewer gesture: try the desk bridge again (e.g. after starting it). */
  retry(): void {
    this.stop();
    this.stopped = false;
    this.mode = 'starting';
    void this.boot();
  }

  private status(s: Partial<FeedStatus>): void {
    useLive.getState().setFeed('volx', s);
  }

  private async boot(): Promise<void> {
    const [mcp, db, user] = await Promise.all([loadCapability('mcp'), loadCapability('db'), loadCapability('user')]);
    if (this.stopped) return;
    this.mcp = mcp;
    this.db = db;
    this.owner = user ? await user.isOwner().catch(() => false) : false;
    if (mcp) await this.poll();
    else this.fallBackToSync('open this page in claude.ai to see VolX');
  }

  private barsSince(): string {
    return previousTradingDay(toEt(Date.now()).date);
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.mcp) return;
    try {
      const res = await this.mcp.callTool(
        DESK_SERVER,
        'desk_events',
        {
          cursor: this.cursor,
          epoch: this.epoch,
          since_date: LIVE_START,
          bar_symbol: 'MES',
          bars_since: this.barsSince(),
          // Only bars that can still change (the building minute) or are new.
          bars_after: this.lastPrice ? this.lastPrice.t - 120_000 : 0,
        },
        { cache: false },
      );
      if (this.stopped) return;
      this.mode = 'bridge';
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      const more = this.absorb(res.payload);
      this.schedulePoll(more ? 250 : POLL_MS);
    } catch (e) {
      if (this.stopped) return;
      const code = isMcpError(e) ? e.code : 'error';
      if (NO_BRIDGE.has(code)) {
        this.fallBackToSync(code === 'cancelled' ? 'desk access was declined' : 'desk bridge not running on this device');
        return;
      }
      // Transient (bridge busy/restarting): keep what we have, show the synced copy meanwhile.
      if (this.mode === 'starting') this.fallBackToSync('desk bridge not answering', true);
      else this.status({ detail: `desk bridge: ${isMcpError(e) ? e.message || code : code}` });
      this.schedulePoll(30_000);
    }
  }

  private schedulePoll(ms: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.poll(), ms);
  }

  /** Applies one bridge payload; returns true when the bridge has more queued. */
  private absorb(payload: unknown): boolean {
    const p = obj(obj(payload).result ?? payload);
    const epoch = str(p.epoch);
    if (epoch !== this.epoch) {
      // New bridge process or a rotated log: start over from what it sends.
      this.epoch = epoch;
      this.events.clear();
    }
    this.cursor = num(p.cursor, this.cursor);
    for (const e of parseDeskEvents(p.events)) this.events.set(deskEventKey(e), e);
    const bars = parseDeskBars(p.bars);
    for (const b of bars) if (!this.lastPrice || b.t >= this.lastPrice.t) this.lastPrice = { t: b.t, c: b.c };
    const lp = obj(p.last_price);
    if (num(lp.c) > 0 && (!this.lastPrice || num(lp.t) >= this.lastPrice.t)) this.lastPrice = { t: num(lp.t), c: num(lp.c) };
    mergeBars(
      this.bars,
      bars.filter((b) => isRth(b.t)),
      etToUtcMs(this.barsSince(), 0),
    );
    this.ready = true;
    const logExists = p.log_exists !== false;
    this.status({
      phase: logExists ? 'live' : 'error',
      detail: logExists ? 'desk bridge · IB paper' : 'desk bridge is up but the desk log was not found',
      asOf: Date.now(),
    });
    this.changed();
    this.scheduleSync();
    return p.more === true;
  }

  /* ---------------- synced copy (other devices) ---------------- */

  private fallBackToSync(reason: string, keepPolling = false): void {
    if (this.mode === 'synced') return;
    this.mode = 'synced';
    if (!keepPolling) window.clearTimeout(this.timer);
    if (!this.db) {
      this.status({ phase: 'offline', detail: reason, asOf: null });
      return;
    }
    this.status({ phase: 'connecting', detail: `${reason} · loading last sync…` });
    const days = new Map<string, DeskEvent[]>();
    const rebuild = () => {
      if (this.mode !== 'synced') return;
      this.events.clear();
      for (const list of days.values()) for (const e of list) this.events.set(deskEventKey(e), e);
      this.changed();
    };
    this.unsubs.push(
      this.db.doc('volx/state').onSnapshot(
        (snap) => {
          if (this.mode !== 'synced') return;
          const d = snap.exists ? (snap.data() ?? {}) : null;
          if (!d) {
            this.status({ phase: 'offline', detail: `${reason} · nothing synced yet (open on the desk PC)`, asOf: null });
            return;
          }
          this.bars.clear();
          mergeBars(this.bars, parseDeskBars(d.bars), 0);
          const lp = obj(d.lastPrice);
          this.lastPrice = num(lp.c) > 0 ? { t: num(lp.t), c: num(lp.c) } : null;
          this.ready = true;
          this.syncedAt = num(d.savedAt, 0);
          this.status({ phase: 'synced', detail: `${reason} · showing the desk's last sync`, asOf: this.syncedAt || null });
          this.changed();
        },
        (err) => this.status({ phase: 'error', detail: `sync unavailable (${err.code})` }),
      ),
      this.db.collection('volx_days').onSnapshot(
        (snap) => {
          days.clear();
          for (const doc of snap.docs) {
            const body = doc.data();
            if (body && doc.id >= LIVE_START) days.set(doc.id, unpackEvents(body.events));
          }
          rebuild();
        },
        () => {},
      ),
    );
  }

  /* ---------------- owner: save the desk state ---------------- */

  private scheduleSync(): void {
    if (!this.db || !this.owner || this.mode !== 'bridge' || this.syncTimer) return;
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = 0;
      void this.sync();
    }, SYNC_DEBOUNCE_MS);
  }

  private async sync(): Promise<void> {
    if (this.syncing || !this.db) return;
    this.syncing = true;
    try {
      const byDay = new Map<string, DeskEvent[]>();
      for (const e of this.events.values()) {
        const t = Date.parse(e.ts);
        if (!Number.isFinite(t) || e.kind === 'session_bars' || e.kind === 'bar') continue;
        const day = toEt(t).date;
        if (day < LIVE_START) continue;
        const list = byDay.get(day) ?? [];
        list.push(e);
        byDay.set(day, list);
      }
      // One write at a time, and only for documents whose content changed.
      for (const [day, list] of [...byDay.entries()].sort()) {
        list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.seq - b.seq);
        await this.writeIfChanged(`volx_days/${day}`, { v: 1, date: day, events: packEvents(list) }, {});
      }
      const bars = [...this.bars.values()].sort((a, b) => a.t - b.t).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]);
      await this.writeIfChanged(
        'volx/state',
        { v: 1, lastEventMs: this.lastEventMs, lastPrice: this.lastPrice, bars },
        { savedAt: Date.now() },
      );
    } catch {
      // Best effort: the next desk update schedules another attempt.
    } finally {
      this.syncing = false;
    }
  }

  private async writeIfChanged(path: string, content: Record<string, unknown>, stamp: Record<string, unknown>): Promise<void> {
    const json = stableJson(content);
    if (!this.written.has(path)) {
      const snap = await this.db!.doc(path).get();
      const prev = snap.exists ? { ...(snap.data() ?? {}) } : null;
      if (prev) for (const k of Object.keys(stamp)) delete prev[k];
      this.written.set(path, prev ? stableJson(prev) : '');
    }
    if (this.written.get(path) === json) return;
    await this.db!.doc(path).set({ ...content, ...stamp });
    this.written.set(path, json);
  }

  derive(cal: LiveCalendar, nowMs: number): FeedOutput {
    const bars = [...this.bars.values()].sort((a, b) => a.t - b.t);
    const out = deriveVolx({
      workerId: TOWERS.volx,
      startMs: etToUtcMs(LIVE_START, 0),
      events: [...this.events.values()],
      bars,
      ready: this.ready,
      stale: this.mode === 'synced' && nowMs - this.syncedAt > STALE_SYNC_MS,
      cal,
      nowMs,
    });
    this.lastEventMs = out.lastEventMs;
    if (this.lastPrice) out.prices = { MES: this.lastPrice.c };
    return out;
  }
}
