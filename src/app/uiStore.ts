import { create } from 'zustand';
import { LIVE_MODE } from '../live/mode';
import type { WorkerId } from '../types/trading';

export type SceneId = 'city' | 'station';

export interface SceneTransition {
  to: SceneId;
  from: SceneId;
  workerId: WorkerId | null;
  phase: 'out' | 'in';
  startedAt: number;
}

export interface LiveSourceConfig {
  /** `claude`: the built-in live towers (claude.ai connectors + desk bridge). */
  kind: 'ws' | 'sse' | 'claude';
  url: string;
}

export interface UiStore {
  /** When set, a live backend drives the UI and the demo engine is idle. */
  live: LiveSourceConfig | null;
  scene: SceneId;
  stationWorkerId: WorkerId;
  selectedWorkerId: WorkerId | null;
  hoveredWorkerId: WorkerId | null;
  summaryOpen: boolean;
  autoDemo: boolean;
  muted: boolean;
  debugOpen: boolean;
  ready: boolean;
  transition: SceneTransition | null;
  cameraResetSeq: number;
  reducedMotion: boolean;
  lowPower: boolean;
  set: (patch: Partial<UiStore>) => void;
}

const reduced =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

const quality = params.get('quality');
const lowPower =
  quality === 'low' ||
  (quality !== 'high' &&
    typeof window !== 'undefined' &&
    (window.innerWidth < 760 || (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4)));

const live: LiveSourceConfig | null = LIVE_MODE
  ? { kind: 'claude', url: '' }
  : params.get('ws')
    ? { kind: 'ws', url: params.get('ws')! }
    : params.get('sse')
      ? { kind: 'sse', url: params.get('sse')! }
      : null;

export const useUi = create<UiStore>()((set) => ({
  live,
  scene: params.get('scene') === 'station' ? 'station' : 'city',
  stationWorkerId: 'qqq-og',
  selectedWorkerId: null,
  hoveredWorkerId: null,
  summaryOpen: false,
  autoDemo: !live && params.get('demo') !== '0',
  muted: true,
  debugOpen: params.get('debug') === '1',
  ready: false,
  transition: null,
  cameraResetSeq: 0,
  reducedMotion: reduced,
  lowPower,
  set: (patch) => set(patch),
}));

export const getUi = () => useUi.getState();
