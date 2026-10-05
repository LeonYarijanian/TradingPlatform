import type { MarketPoint, Ticker } from '../types/trading';

/**
 * Mutable, non-reactive store of closed minute bars per ticker.
 *
 * Charts read it inside their render loops (useFrame / canvas redraws), so
 * appending hundreds of bars per second never triggers React renders.
 */
export class MarketBuffer {
  private data: Record<Ticker, MarketPoint[]> = { QQQ: [], SPY: [], IWM: [] };
  version = 0;

  constructor(private readonly capacity = 1600) {}

  push(ticker: Ticker, point: MarketPoint): void {
    const list = this.data[ticker];
    const last = list[list.length - 1];
    if (last && last.timestamp >= point.timestamp) return;
    list.push(point);
    if (list.length > this.capacity) list.splice(0, list.length - this.capacity);
    this.version++;
  }

  points(ticker: Ticker): readonly MarketPoint[] {
    return this.data[ticker];
  }

  /** Points with timestamp in [from, to]. Pass `out` to reuse an array in render loops. */
  window(ticker: Ticker, from: number, to = Infinity, out: MarketPoint[] = []): MarketPoint[] {
    const list = this.data[ticker];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].timestamp < from) lo = mid + 1;
      else hi = mid;
    }
    out.length = 0;
    for (let i = lo; i < list.length && list[i].timestamp <= to; i++) out.push(list[i]);
    return out;
  }

  last(ticker: Ticker): MarketPoint | undefined {
    const list = this.data[ticker];
    return list[list.length - 1];
  }

  clear(): void {
    this.data = { QQQ: [], SPY: [], IWM: [] };
    this.version++;
  }
}
