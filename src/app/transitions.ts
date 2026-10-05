import type { WorkerId } from '../types/trading';
import { getUi, useUi, type SceneId } from './uiStore';

/** City → station: camera fly-in, flash, reveal. Total ≈ 900 ms. */
export const TRANSITION_OUT_MS = 430;
export const TRANSITION_IN_MS = 520;

let timers: number[] = [];

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
}

export function goToScene(to: SceneId, workerId?: WorkerId | null, opts: { instant?: boolean } = {}): void {
  const ui = getUi();
  const nextWorker = workerId ?? ui.transition?.workerId ?? ui.stationWorkerId;
  // Already heading there: don't restart the fly-out (e.g. key repeat).
  if (ui.transition && ui.transition.to === to && (to === 'city' || ui.transition.workerId === nextWorker)) return;
  const sameScene = ui.scene === to && (to === 'city' || nextWorker === ui.stationWorkerId);
  if (sameScene && !ui.transition) return;
  clearTimers();
  // A hovered tower never receives pointer-out once its scene is hidden.
  if (typeof document !== 'undefined') document.body.style.cursor = '';

  const patchFor = (): Partial<ReturnType<typeof getUi>> =>
    to === 'station' ? { scene: 'station', stationWorkerId: nextWorker, hoveredWorkerId: null } : { scene: 'city', hoveredWorkerId: null };

  if (opts.instant) {
    useUi.setState({ ...patchFor(), transition: null });
    return;
  }

  const from = ui.scene;
  useUi.setState({
    transition: { to, from, workerId: to === 'station' ? nextWorker : ui.stationWorkerId, phase: 'out', startedAt: performance.now() },
  });
  timers.push(
    window.setTimeout(() => {
      useUi.setState({
        ...patchFor(),
        transition: { to, from, workerId: nextWorker, phase: 'in', startedAt: performance.now() },
      });
      timers.push(window.setTimeout(() => useUi.setState({ transition: null }), TRANSITION_IN_MS));
    }, TRANSITION_OUT_MS),
  );
}

/** The worker the station shows, or is about to show mid-transition. */
export function pendingStationWorker(): WorkerId {
  const ui = getUi();
  return ui.transition?.to === 'station' && ui.transition.workerId ? ui.transition.workerId : ui.stationWorkerId;
}

/** The scene we are in, or heading to. */
export function effectiveScene(): SceneId {
  const ui = getUi();
  return ui.transition?.to ?? ui.scene;
}

/** Focus a worker in the city (camera tween + detail card). */
export function selectWorker(id: WorkerId | null): void {
  useUi.setState({ selectedWorkerId: id });
}

export function resetCamera(): void {
  useUi.setState((s) => ({ selectedWorkerId: null, cameraResetSeq: s.cameraResetSeq + 1 }));
}

/** Any manual interaction hands control back to the user. */
export function takeManualControl(): void {
  if (getUi().autoDemo) useUi.setState({ autoDemo: false });
}
