import { SESSION_MINUTES } from '../data/demoRun';
import { TICKERS, TICKER_PROFILES } from '../data/marketData';
import type { MarketPoint, Ticker } from '../types/trading';
import { createRng, gaussian, hashSeed } from './rng';

export interface TickerSeries {
  ticker: Ticker;
  /** Close price at each global minute index (day * 390 + minute). */
  price: Float64Array;
  vwap: Float64Array;
  ema50: Float64Array;
  dayOpen: number[];
  dayClose: number[];
}

export interface MarketSeries {
  days: number;
  totalMinutes: number;
  tickers: Record<Ticker, TickerSeries>;
}

const EMA_ALPHA = 2 / (50 + 1);

/** Intraday volume profile (U-shaped). */
function volumeAt(minute: number): number {
  return 1 + 1.8 * Math.exp(-minute / 25) + 1.2 * Math.exp(-(SESSION_MINUTES - minute) / 30);
}

/**
 * Generates a deterministic, correlated minute-bar market for the whole run.
 * Prices start at each ticker's `startPrice` and are drift-corrected so the
 * final close lands on `endPrice`.
 */
export function generateMarket(days: number, seed: number): MarketSeries {
  const totalMinutes = days * SESSION_MINUTES;
  const common = createRng(seed ^ 0x9e3779b9);
  const commonShocks = new Float64Array(totalMinutes);
  const commonDayDrift: number[] = [];
  for (let d = 0; d < days; d++) commonDayDrift.push(gaussian(common) * 0.0045);
  for (let i = 0; i < totalMinutes; i++) commonShocks[i] = gaussian(common);

  const tickers = {} as Record<Ticker, TickerSeries>;
  for (const ticker of TICKERS) {
    const profile = TICKER_PROFILES[ticker];
    const rng = createRng(seed ^ hashSeed(ticker));
    const out = new Float64Array(totalMinutes);
    const sigma = profile.minuteVol;
    // Log-price = linear trend (start → end) + mean-reverting deviation X.
    // Mean reversion keeps multi-day drift within a believable band.
    const theta = (sigma * sigma) / (2 * 0.0035 * 0.0035);
    const trendSlope = Math.log(profile.endPrice / profile.startPrice) / (totalMinutes - 1);
    let x = 0;
    let swing = 0;

    for (let d = 0; d < days; d++) {
      if (d > 0) x += gaussian(rng) * 0.0016;
      const dayBias = commonDayDrift[d] * 0.6 + gaussian(rng) * 0.0018;
      for (let m = 0; m < SESSION_MINUTES; m++) {
        const i = d * SESSION_MINUTES + m;
        const shock = 0.72 * commonShocks[i] + 0.69 * gaussian(rng);
        const openBoost = m < 30 ? 1.55 - m / 55 : 1;
        // Short tradable runs: a drift that changes every ~20 minutes.
        if (m % 20 === 0) swing = gaussian(rng) * sigma * 0.2;
        x = x * (1 - theta) + dayBias / SESSION_MINUTES + swing + shock * sigma * openBoost;
        out[i] = profile.startPrice * Math.exp(trendSlope * i + x);
      }
    }
    // Pin the final close exactly on the target.
    const correction = Math.log(profile.endPrice / out[totalMinutes - 1]);
    for (let i = 0; i < totalMinutes; i++) out[i] *= Math.exp((correction * i) / (totalMinutes - 1));

    const vwap = new Float64Array(totalMinutes);
    const ema = new Float64Array(totalMinutes);
    // Warm the EMA slightly below price so it doesn't start glued to it.
    let e = out[0] * (1 - 0.0012);
    const dayOpen: number[] = [];
    const dayClose: number[] = [];
    for (let d = 0; d < days; d++) {
      let pv = 0;
      let vol = 0;
      for (let m = 0; m < SESSION_MINUTES; m++) {
        const i = d * SESSION_MINUTES + m;
        const v = volumeAt(m) * (0.6 + 0.8 * rng());
        pv += out[i] * v;
        vol += v;
        vwap[i] = pv / vol;
        e += (out[i] - e) * EMA_ALPHA;
        ema[i] = e;
      }
      dayOpen.push(out[d * SESSION_MINUTES]);
      dayClose.push(out[d * SESSION_MINUTES + SESSION_MINUTES - 1]);
    }

    tickers[ticker] = { ticker, price: out, vwap, ema50: ema, dayOpen, dayClose };
  }

  return { days, totalMinutes, tickers };
}

/** Deterministic micro-jitter so the live price "breathes" between bars. */
function jitter(t: number, ticker: Ticker): number {
  const k = ticker === 'QQQ' ? 1 : ticker === 'SPY' ? 1.7 : 2.3;
  return Math.sin(t * 37.1 * k) * 0.45 + Math.sin(t * 91.7 + k) * 0.35 + Math.sin(t * 13.3 * k) * 0.2;
}

/** Interpolated live price at fractional global minute `t`. */
export function priceAt(series: MarketSeries, ticker: Ticker, t: number): number {
  const s = series.tickers[ticker];
  const clamped = Math.max(0, Math.min(series.totalMinutes - 1, t));
  const i = Math.floor(clamped);
  const f = clamped - i;
  const sameDay = Math.floor(i / SESSION_MINUTES) === Math.floor((i + 1) / SESSION_MINUTES);
  const next = sameDay && i + 1 < series.totalMinutes ? s.price[i + 1] : s.price[i];
  const base = s.price[i] + (next - s.price[i]) * f;
  const amp = s.price[i] * TICKER_PROFILES[ticker].minuteVol * 0.35;
  return base + jitter(t, ticker) * amp * Math.sin(Math.PI * f);
}

export function pointAt(series: MarketSeries, ticker: Ticker, index: number): MarketPoint {
  const s = series.tickers[ticker];
  return { timestamp: index, price: s.price[index], vwap: s.vwap[index], ema50: s.ema50[index] };
}
