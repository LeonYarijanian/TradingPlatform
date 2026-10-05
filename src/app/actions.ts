import { resetRun } from '../simulation/controller';
import { usePlayback } from '../simulation/simulationStore';
import { demoDirector } from './director';
import { goToScene } from './transitions';
import { useUi } from './uiStore';

/** Full replay: reset trading state, market timeline and workers, then rerun the auto demo. */
export function replay(): void {
  // In live mode the backend owns the state; replaying the demo would wipe it.
  if (useUi.getState().live) {
    useUi.setState({ summaryOpen: false });
    return;
  }
  useUi.setState({ summaryOpen: false, selectedWorkerId: null });
  resetRun();
  usePlayback.setState({ playing: true });
  demoDirector.stop();
  useUi.setState({ autoDemo: true });
}

/** Reset without restarting the auto demo (debug panel). */
export function resetSimulation(): void {
  if (useUi.getState().live) return;
  useUi.setState({ summaryOpen: false });
  demoDirector.stop();
  useUi.setState({ autoDemo: false });
  resetRun();
  goToScene('city');
}

export function openSummary(): void {
  useUi.setState({ summaryOpen: true });
}

export function closeSummary(): void {
  useUi.setState({ summaryOpen: false });
}
