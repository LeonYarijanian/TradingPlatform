import { create } from 'zustand';
import type { WorkerId } from '../types/trading';

export type SceneId = 'city' | 'station';

export interface SceneTransition {
  to: SceneId;
  from: SceneId;
  workerId: WorkerId | null;
  phase: 'out' | 'in';
  startedAt: number;
}

export interface UiStore {
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

export const useUi = create<UiStore>()((set) => ({
  scene: params.get('scene') === 'station' ? 'station' : 'city',
  stationWorkerId: 'qqq-og',
  selectedWorkerId: null,
  hoveredWorkerId: null,
  summaryOpen: false,
  autoDemo: params.get('demo') !== '0',
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
