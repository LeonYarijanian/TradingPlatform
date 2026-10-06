import { ALL_TICKERS, type MarketPoint, type Ticker } from '../types/trading';

const emptyData = () => Object.fromEntries(ALL_TICKERS.map((t) => [t, []])) as unknown as Record<Ticker, MarketPoint[]>;

/**
 * Mutable, non-reactive store of closed minute bars per ticker.
 *
 * Charts read it inside their render loops (useFrame / canvas redraws), so
 * appending hundreds of bars per second never triggers React renders.
 */
export class MarketBuffer {
  private data: Record<Ticker, MarketPoint[]> = emptyData();
  version = 0;

  constructor(private readonly capacity = 1600) {}

  /** Appends a closed bar; a bar with the newest bar's timestamp replaces it (live bars firm up). */
  push(ticker: Ticker, point: MarketPoint): void {
    const list = this.data[ticker];
    const last = list[list.length - 1];
    if (last && last.timestamp === point.timestamp) {
      list[list.length - 1] = point;
      this.version++;
      return;
    }
    if (last && last.timestamp > point.timestamp) return;
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

  /**
   * Session to chart for `day`: that day once it has bars, otherwise the most
   * recent session with data (pre-market / weekends show the last close).
   */
  focusDay(ticker: Ticker, day: number, sessionMinutes: number): number {
    const last = this.last(ticker);
    if (!last || last.timestamp >= day * sessionMinutes) return day;
    return Math.floor(last.timestamp / sessionMinutes);
  }

  clear(): void {
    this.data = emptyData();
    this.version++;
  }
}
