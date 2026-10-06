import { create } from 'zustand';
import type { FeedId, FeedStatus } from './feed';
import type { SessionPhase } from './marketClock';

export interface LiveClock {
  /** "Tue 10/6" */
  label: string;
  /** Minutes since 9:30 ET (unclamped). */
  minute: number;
  phase: SessionPhase;
}

export interface LiveStore {
  feeds: Record<FeedId, FeedStatus>;
  clock: LiveClock | null;
  setFeed: (id: FeedId, status: Partial<FeedStatus>) => void;
}

const initial: FeedStatus = { phase: 'connecting', detail: 'connecting…', asOf: null };

export const useLive = create<LiveStore>()((set) => ({
  feeds: { volx: initial, 'rh-spx': initial, 'rh-me': initial },
  clock: null,
  setFeed: (id, status) => set((s) => ({ feeds: { ...s.feeds, [id]: { ...s.feeds[id], ...status } } })),
}));
