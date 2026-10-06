import type { DemoTicker, Ticker } from '../types/trading';

export interface TickerProfile {
  ticker: DemoTicker;
  /** Price at the open of day 1. */
  startPrice: number;
  /** Approximate price at the close of the last day. */
  endPrice: number;
  /** Per-minute volatility as a fraction of price. */
  minuteVol: number;
  /** Typical ATR (1-min) in price units, used by the scanner. */
  atr: number;
  /** Typical ATM 0DTE option premium. */
  premium: [number, number];
}

export const TICKERS: readonly DemoTicker[] = ['QQQ', 'SPY', 'IWM'];

/** Demo instruments only — the engine never simulates the live tickers. */
export const TICKER_PROFILES = {
  QQQ: { ticker: 'QQQ', startPrice: 699.4, endPrice: 716.2, minuteVol: 0.00034, atr: 0.62, premium: [2.9, 4.6] },
  SPY: { ticker: 'SPY', startPrice: 752.8, endPrice: 768.9, minuteVol: 0.00027, atr: 0.55, premium: [2.4, 4.1] },
  IWM: { ticker: 'IWM', startPrice: 241.3, endPrice: 249.6, minuteVol: 0.00042, atr: 0.21, premium: [1.1, 2.2] },
} satisfies Record<DemoTicker, TickerProfile> as Record<Ticker, TickerProfile>;
