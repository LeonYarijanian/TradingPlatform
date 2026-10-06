/**
 * Which city to run.
 *
 * - `live`: the towers are wired to real accounts (VolX desk, Robinhood SPX
 *   bot, the owner's Robinhood account) through the claude.ai page runtime.
 * - `demo`: the deterministic 23-day showcase run.
 *
 * Inside claude.ai (where `window.claude` exists) the city starts live; a
 * plain `#demo` / `#live` link anchor overrides that, and a `?ws=` / `?sse=`
 * backend keeps the demo bots so an external feed can drive them.
 */
export type CityMode = 'live' | 'demo';

function detect(): CityMode {
  if (typeof window === 'undefined') return 'demo';
  const hash = window.location.hash.replace('#', '').toLowerCase();
  if (hash === 'demo') return 'demo';
  if (hash === 'live') return 'live';
  const params = new URLSearchParams(window.location.search);
  if (params.get('ws') || params.get('sse')) return 'demo';
  return 'claude' in window ? 'live' : 'demo';
}

export const CITY_MODE: CityMode = detect();
export const LIVE_MODE = CITY_MODE === 'live';

/** Switches modes by reloading with the other anchor (the page keeps no other state). */
export function switchCityMode(mode: CityMode): void {
  try {
    window.location.hash = mode;
    window.location.reload();
  } catch {
    // A frame that refuses navigation keeps the current mode.
  }
}
