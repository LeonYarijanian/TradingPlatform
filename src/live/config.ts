import type { WorkerId } from '../types/trading';

/** First session the live city counts (no history before it). */
export const LIVE_START = '2026-10-06';

/** claude.ai connector display name for the Robinhood tools. */
export const ROBINHOOD_SERVER = 'Robinhood Agent';

/** The VolX desk bridge: a local MCP server named "volxdesk" in the Claude desktop app. */
export const DESK_SERVER = 'host:volxdesk';

/** Robinhood's instrument id for the S&P 500 index (public reference data). */
export const SPX_INDEX_ID = '432fbbb8-b82c-454a-852d-eb85382c7066';

export const TOWERS = {
  volx: 'qqq-og',
  spxBot: 'qqq-trend',
  mine: 'qqq',
} as const satisfies Record<string, WorkerId>;
