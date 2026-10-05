import { goToScene, pendingStationWorker, takeManualControl } from '../app/transitions';
import { useUi } from '../app/uiStore';
import { WORKERS, WORKER_BY_ID } from '../data/workers';

function cycleStation(delta: number) {
  const idx = WORKERS.findIndex((w) => w.id === pendingStationWorker());
  takeManualControl();
  goToScene('station', WORKERS[(idx + delta + WORKERS.length) % WORKERS.length].id);
}

/** Workstation chrome: back to city + worker switcher. */
export function StationOverlay() {
  const scene = useUi((s) => s.scene);
  const id = useUi((s) => s.stationWorkerId);
  if (scene !== 'station') return null;
  const cfg = WORKER_BY_ID[id];
  return (
    <div className="station-bar" style={{ ['--accent' as string]: cfg.accent }}>
      <button
        type="button"
        className="ghost-btn"
        onClick={() => {
          takeManualControl();
          goToScene('city');
        }}
        aria-label="Back to city (Escape)"
      >
        ◂ CITY <kbd>esc</kbd>
      </button>
      <div className="sb-switch">
        <button type="button" className="icon-btn" onClick={() => cycleStation(-1)} aria-label="Previous worker">
          ◂
        </button>
        <div className="sb-title">
          <span className="sb-kicker">WORKSTATION</span>
          <span className="sb-name">{cfg.displayName}</span>
        </div>
        <button type="button" className="icon-btn" onClick={() => cycleStation(1)} aria-label="Next worker">
          ▸
        </button>
      </div>
    </div>
  );
}
