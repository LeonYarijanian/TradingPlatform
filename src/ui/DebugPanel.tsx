import { openSummary, resetSimulation } from '../app/actions';
import { takeManualControl } from '../app/transitions';
import { useUi } from '../app/uiStore';
import { WORKERS } from '../data/workers';
import { endDay, injectSignal, skipToEnd } from '../simulation/controller';
import { SPEEDS, usePlayback } from '../simulation/simulationStore';
import type { OptionDirection, WorkerId } from '../types/trading';

/** Hidden demo/debug controls for exercising every animation on demand. */
export function DebugPanel() {
  const open = useUi((s) => s.debugOpen);
  const playing = usePlayback((s) => s.playing);
  const speed = usePlayback((s) => s.speed);
  const selected = useUi((s) => s.selectedWorkerId);
  const scene = useUi((s) => s.scene);
  const station = useUi((s) => s.stationWorkerId);
  if (!open) return null;
  const target: WorkerId = scene === 'station' ? station : selected ?? 'qqq';
  const trigger = (dir: OptionDirection) => {
    takeManualControl();
    injectSignal(target, dir);
  };
  return (
    <section className="debug-panel" aria-label="Simulation controls">
      <header>
        <span>SIM CONTROLS</span>
        <button type="button" className="icon-btn" onClick={() => useUi.setState({ debugOpen: false })} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="dp-row">
        <button type="button" onClick={() => usePlayback.setState({ playing: true })} className={playing ? 'on' : ''}>
          ▶ Play
        </button>
        <button type="button" onClick={() => usePlayback.setState({ playing: false })} className={!playing ? 'on' : ''}>
          ❚❚ Pause
        </button>
      </div>
      <div className="dp-row">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={speed === s ? 'on' : ''}
            onClick={() => {
              takeManualControl();
              usePlayback.setState({ speed: s });
            }}
          >
            {s}x
          </button>
        ))}
      </div>
      <div className="dp-row">
        <label className="dp-label" htmlFor="dp-worker">
          worker
        </label>
        <select
          id="dp-worker"
          value={target}
          onChange={(e) => {
            const id = e.target.value as WorkerId;
            if (scene === 'station') useUi.setState({ stationWorkerId: id });
            else useUi.setState({ selectedWorkerId: id });
          }}
        >
          {WORKERS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}
            </option>
          ))}
        </select>
      </div>
      <div className="dp-row">
        <button type="button" className="call" onClick={() => trigger('CALL')}>
          ▲ Trigger CALL
        </button>
        <button type="button" className="put" onClick={() => trigger('PUT')}>
          ▼ Trigger PUT
        </button>
      </div>
      <div className="dp-row">
        <button
          type="button"
          onClick={() => {
            takeManualControl();
            endDay();
          }}
        >
          End Day
        </button>
        <button
          type="button"
          onClick={() => {
            takeManualControl();
            skipToEnd();
          }}
        >
          Skip to End
        </button>
      </div>
      <div className="dp-row">
        <button type="button" onClick={() => resetSimulation()}>
          ↺ Reset
        </button>
        <button type="button" onClick={() => openSummary()}>
          Show Summary
        </button>
      </div>
      <p className="dp-hint">Space pause · 1-5 workers · ←/→ cycle · Enter station · Esc back · M sound · R camera</p>
    </section>
  );
}
