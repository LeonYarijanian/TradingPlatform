import { create } from 'zustand';
import type { BotEvent, WorkerId } from '../types/trading';
import { MarketBuffer } from './marketBuffer';
import { createInitialSimData, reduceEvents, type SimData } from './reducer';

export const marketBuffer = new MarketBuffer();

export interface SimulationStore extends SimData {
  /** Feed protocol events from any source (demo engine, websocket, SSE…). */
  ingest: (events: readonly BotEvent[]) => void;
}

export const useSim = create<SimulationStore>()((set) => ({
  ...createInitialSimData(),
  ingest: (events) => {
    for (const ev of events) {
      if (ev.type === 'RUN_INIT') marketBuffer.clear();
      else if (ev.type === 'MARKET_BAR') marketBuffer.push(ev.ticker, ev.point);
    }
    set((state) => reduceEvents(state, events));
  },
}));

export const SPEEDS = [1, 2, 5, 10] as const;

export interface PlaybackStore {
  playing: boolean;
  /** User-selected multiplier. */
  speed: number;
  /** Multiplier actually applied this frame (differs while AUTO DEMO drives). */
  effectiveSpeed: number;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: number) => void;
}

export const usePlayback = create<PlaybackStore>()((set) => ({
  playing: true,
  speed: 1,
  effectiveSpeed: 1,
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed }),
}));

/** Convenience non-reactive accessors for render loops. */
export const getSim = () => useSim.getState();
export const getWorker = (id: WorkerId) => useSim.getState().workers[id];
