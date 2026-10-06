import { LIVE_MODE } from '../live/mode';
import type { WorkerConfig, WorkerId } from '../types/trading';

/**
 * The five demo trading workers. Order matters: it is the left → right order
 * of the skyscrapers in the city and the 1-5 hotkey order.
 */
export const DEMO_WORKERS: readonly WorkerConfig[] = [
  {
    id: 'qqq-og',
    ticker: 'QQQ',
    displayName: 'QQQ OG',
    strategy: '0DTE momentum scalper',
    setupName: 'EMA50 cross',
    towerHeight: 0.68,
    accent: '#5DFFDA',
    position: [-7.4, 0, 0],
    hotkey: 1,
  },
  {
    id: 'qqq-trend',
    ticker: 'QQQ',
    displayName: 'QQQ TREND',
    strategy: 'Trend pullback rider',
    setupName: 'VWAP pullback',
    towerHeight: 0.6,
    accent: '#47F4FF',
    position: [-3.7, 0, -1],
    hotkey: 2,
  },
  {
    id: 'qqq',
    ticker: 'QQQ',
    displayName: 'QQQ',
    strategy: 'Opening-range breakout',
    setupName: 'ORB break',
    towerHeight: 1,
    accent: '#F8FAFF',
    position: [0, 0, -2],
    hotkey: 3,
  },
  {
    id: 'spy',
    ticker: 'SPY',
    displayName: 'SPY',
    strategy: 'VWAP reclaim / theta',
    setupName: 'VWAP reclaim',
    towerHeight: 0.62,
    accent: '#FFD247',
    position: [3.7, 0, -1],
    hotkey: 4,
  },
  {
    id: 'iwm',
    ticker: 'IWM',
    displayName: 'IWM',
    strategy: 'Buy-the-dip reversal',
    setupName: 'RSI dip',
    towerHeight: 0.58,
    accent: '#B58CFF',
    position: [7.4, 0, 0],
    hotkey: 5,
  },
] as const;

/**
 * Live mode keeps the same five buildings (ids, positions, heights) and swaps
 * in the real desks: left = VolX (IB paper futures), next = the Robinhood SPX
 * bot, middle = the owner's own Robinhood trading. The two spare towers stay
 * dark until something real is connected to them.
 */
const LIVE_PROFILE: Record<WorkerId, Partial<WorkerConfig>> = {
  'qqq-og': {
    ticker: 'MES',
    displayName: 'VOLX',
    strategy: 'MES vol breakout · overnight MNQ/MCL',
    setupName: 'VolX break',
    paper: true,
  },
  'qqq-trend': {
    ticker: 'SPX',
    displayName: 'SPX BOT',
    strategy: 'XSP 0DTE credit spreads',
    setupName: 'credit spread',
  },
  qqq: {
    ticker: 'QQQ',
    displayName: 'MY ROBINHOOD',
    strategy: 'Robinhood options · manual',
    setupName: 'discretionary',
  },
  spy: { strategy: 'not connected', setupName: 'offline', offline: true },
  iwm: { strategy: 'not connected', setupName: 'offline', offline: true },
};

export const WORKERS: readonly WorkerConfig[] = LIVE_MODE ? DEMO_WORKERS.map((w) => ({ ...w, ...LIVE_PROFILE[w.id] })) : DEMO_WORKERS;

export const WORKER_IDS: readonly WorkerId[] = WORKERS.map((w) => w.id);

export const WORKER_BY_ID: Record<WorkerId, WorkerConfig> = Object.fromEntries(WORKERS.map((w) => [w.id, w])) as Record<
  WorkerId,
  WorkerConfig
>;

export function workerByHotkey(key: number): WorkerConfig | undefined {
  return WORKERS.find((w) => w.hotkey === key);
}

/** The demo engine always simulates the demo roster, whichever city is shown. */
export const DEMO_WORKER_BY_ID: Record<WorkerId, WorkerConfig> = Object.fromEntries(DEMO_WORKERS.map((w) => [w.id, w])) as Record<
  WorkerId,
  WorkerConfig
>;
