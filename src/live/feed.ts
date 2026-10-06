/**
 * Shared shapes for live feeds.
 *
 * Every live source is a pure `derive()` from the raw data it has fetched to
 * protocol events. One-shot events (fills, closes, thoughts) carry a stable
 * key so the runner can re-derive at any time and only ingest what is new;
 * worker status, positions and bars are state the runner diffs.
 */
import { SESSION_MINUTES } from '../data/demoRun';
import type { BotEvent, BotStatusEvent, MarketPoint, OpenPosition, Ticker, WorkerId } from '../types/trading';
import type { LiveCalendar } from './marketClock';

export interface KeyedEvent {
  key: string;
  /** Sort order within a flush (chart timestamp; sessions use ±0.5). */
  ts: number;
  ev: BotEvent;
}

export interface WorkerLiveState {
  status: Omit<BotStatusEvent, 'type' | 'workerId'>;
  position: OpenPosition | null;
}

export interface FeedOutput {
  events: KeyedEvent[];
  bars?: Partial<Record<Ticker, MarketPoint[]>>;
  /** Latest trade price per instrument (may be newer than the last closed bar). */
  prices?: Partial<Record<Ticker, number>>;
  workers?: Partial<Record<WorkerId, WorkerLiveState>>;
}

export type FeedId = 'volx' | 'rh-spx' | 'rh-me';

export type FeedPhase =
  | 'connecting'
  /** Fresh data from the source itself. */
  | 'live'
  /** Last state synced from another device (VolX away from the desk PC). */
  | 'synced'
  | 'offline'
  | 'needs-auth'
  | 'blocked'
  | 'error';

export interface FeedStatus {
  phase: FeedPhase;
  detail: string;
  /** Epoch ms of the data shown (from the source, never the page clock). */
  asOf: number | null;
}

/** A raw OHLCV bar, epoch-ms open time. Volume is NaN for indexes. */
export interface RawBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const num = (v: unknown, fallback = NaN): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
};

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const EMA_ALPHA = 2 / 51;

/**
 * Regular-session bars → chart points: EMA50 runs across sessions, VWAP
 * resets each session (and is NaN when the instrument reports no volume).
 */
export function barsToPoints(bars: readonly RawBar[], cal: LiveCalendar): MarketPoint[] {
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const out: MarketPoint[] = [];
  let ema = NaN;
  let vwapDay = NaN;
  let pv = 0;
  let vol = 0;
  for (const b of sorted) {
    if (!(b.c > 0)) continue;
    const loc = cal.locate(b.t);
    if (loc.minute < 0 || loc.minute >= SESSION_MINUTES) continue;
    const timestamp = loc.dayIndex * SESSION_MINUTES + Math.floor(loc.minute);
    if (out.length && out[out.length - 1].timestamp >= timestamp) continue;
    ema = Number.isFinite(ema) ? ema + EMA_ALPHA * (b.c - ema) : b.c;
    if (loc.dayIndex !== vwapDay) {
      vwapDay = loc.dayIndex;
      pv = 0;
      vol = 0;
    }
    if (b.v > 0) {
      pv += ((b.h + b.l + b.c) / 3) * b.v;
      vol += b.v;
    }
    out.push({ timestamp, price: b.c, vwap: vol > 0 ? pv / vol : NaN, ema50: ema });
  }
  return out;
}

/** Close of the bar at or just before `ms` (for placing fills on a chart). */
export function priceAt(bars: readonly RawBar[], ms: number): number {
  let best: RawBar | null = null;
  for (const b of bars) if (b.t <= ms && (!best || b.t > best.t)) best = b;
  return best && ms - best.t < 5 * 60_000 ? best.c : 0;
}

export const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** JSON with object keys sorted, for comparing documents regardless of key order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
