/**
 * Core trading domain types.
 *
 * Everything the UI renders is derived from a stream of `BotEvent`s. The demo
 * simulation produces these events from a deterministic schedule; a live
 * backend (websocket / SSE / Python bot API) can produce the exact same events
 * and the whole interface will react identically.
 */

export type WorkerId = 'qqq-og' | 'qqq-trend' | 'qqq' | 'spy' | 'iwm';

export type Ticker = 'QQQ' | 'SPY' | 'IWM';

export type WorkerStatus =
  | 'watching'
  | 'scanning'
  | 'charging'
  | 'ready'
  | 'firing'
  | 'managing'
  | 'trailing'
  | 'cooldown'
  | 'off-duty';

export type OptionDirection = 'CALL' | 'PUT';

/** Static configuration of a trading worker (bot). */
export interface WorkerConfig {
  id: WorkerId;
  ticker: Ticker;
  displayName: string;
  strategy: string;
  /** Short setup name shown on the signal scanner, e.g. "EMA50 cross". */
  setupName: string;
  /** Relative tower height, 1 = tallest (QQQ). */
  towerHeight: number;
  accent: string;
  position: [number, number, number];
  /** Hotkey number (1-5). */
  hotkey: number;
}

/** Live worker strategy state (what a live backend would stream). */
export interface WorkerStrategyState {
  id: WorkerId;
  ticker: Ticker;
  status: WorkerStatus;
  direction: OptionDirection | null;
  /** 0..100 */
  charge: number;
  earned: number;
}

export interface OpenPosition {
  tradeId: string;
  direction: OptionDirection;
  contracts: number;
  entryPrice: number;
  underlyingPrice: number;
  openedAt: number;
}

/** Runtime worker state held in the store. */
export interface WorkerRuntime extends WorkerStrategyState {
  /** Distance from trigger, in ATRs (for the scanner). */
  atrAway: number;
  todayPnl: number;
  tradesToday: number;
  wins: number;
  losses: number;
  position: OpenPosition | null;
  lastPnl: number | null;
}

export interface TradeEvent {
  id: string;
  workerId: WorkerId;
  ticker: Ticker;
  dayIndex: number;
  /** Minute of the trading session (0 = 9:30 ET). */
  entryMinute: number;
  exitMinute: number;
  /** Minute charging starts. */
  chargeStartMinute: number;
  direction: OptionDirection;
  contracts: number;
  entryPrice: number;
  exitPrice: number;
  underlyingPrice: number;
  pnl: number;
  /** Human readable exit reason. */
  exitReason: 'trail' | 'target' | 'stop' | 'time';
  description: string;
}

/** A charge that builds and then fizzles without firing. */
export interface FizzleEvent {
  workerId: WorkerId;
  dayIndex: number;
  startMinute: number;
  peakMinute: number;
  endMinute: number;
  peakCharge: number;
  direction: OptionDirection;
}

export interface TradingDay {
  index: number;
  /** ISO date YYYY-MM-DD */
  date: string;
  /** e.g. "Tue 9/15" */
  label: string;
  pnl: number;
  percent?: number;
  events: TradeEvent[];
}

export interface MarketPoint {
  /** Global trading-minute index since the start of the run. */
  timestamp: number;
  price: number;
  vwap: number;
  ema50: number;
}

export interface MarketTick {
  ticker: Ticker;
  timestamp: number;
  price: number;
}

export interface ChartMarker {
  id: string;
  workerId: WorkerId;
  timestamp: number;
  price: number;
  direction: OptionDirection;
  kind: 'entry' | 'exit';
  pnl?: number;
}

export type LogTone = 'action' | 'profit' | 'loss' | 'warn' | 'info';

export interface LogEntry {
  id: string;
  workerId: WorkerId;
  dayIndex: number;
  minute: number;
  text: string;
  tone: LogTone;
}

/* ------------------------------------------------------------------ */
/* Event protocol                                                      */
/* ------------------------------------------------------------------ */

/** Sent once when a run (backtest replay / live session series) starts. */
export interface RunInitEvent {
  type: 'RUN_INIT';
  days: Array<{ date: string; label: string }>;
}

export interface ClockEvent {
  type: 'CLOCK';
  dayIndex: number;
  /** Fractional minute within the session (0..390). */
  minute: number;
  finished: boolean;
}

export interface SessionEvent {
  type: 'SESSION';
  dayIndex: number;
  phase: 'open' | 'close';
}

export interface MarketTickEvent {
  type: 'MARKET_TICK';
  ticker: Ticker;
  timestamp: number;
  price: number;
}

export interface MarketBarEvent {
  type: 'MARKET_BAR';
  ticker: Ticker;
  point: MarketPoint;
}

export interface BotStatusEvent {
  type: 'BOT_STATUS';
  workerId: WorkerId;
  status: WorkerStatus;
  direction: OptionDirection | null;
  charge: number;
  atrAway?: number;
}

export interface TradeExecutedEvent {
  type: 'TRADE_EXECUTED';
  workerId: WorkerId;
  tradeId: string;
  ticker: Ticker;
  direction: OptionDirection;
  contracts: number;
  entry: number;
  underlying: number;
  dayIndex: number;
  minute: number;
  timestamp: number;
}

export interface TradeClosedEvent {
  type: 'TRADE_CLOSED';
  workerId: WorkerId;
  tradeId: string;
  pnl: number;
  exit: number;
  reason: TradeEvent['exitReason'];
  dayIndex: number;
  minute: number;
  timestamp: number;
  underlying: number;
}

export interface ThoughtEvent {
  type: 'THOUGHT';
  workerId: WorkerId;
  dayIndex: number;
  minute: number;
  text: string;
  tone: LogTone;
}

export type BotEvent =
  | RunInitEvent
  | ClockEvent
  | SessionEvent
  | MarketTickEvent
  | MarketBarEvent
  | BotStatusEvent
  | TradeExecutedEvent
  | TradeClosedEvent
  | ThoughtEvent;

/** Anything that can push trading events into the UI (demo engine, websocket, SSE...). */
export interface BotEventSource {
  subscribe(listener: (events: BotEvent[]) => void): () => void;
}

/** Price feed abstraction for a future live integration. */
export interface MarketDataProvider {
  subscribe(ticker: Ticker, callback: (tick: MarketTick) => void): () => void;
}
