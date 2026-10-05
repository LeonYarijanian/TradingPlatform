import { goToScene, resetCamera, takeManualControl } from '../app/transitions';
import { useUi } from '../app/uiStore';
import { replay } from '../app/actions';
import { SPEEDS, usePlayback } from '../simulation/simulationStore';
import { engine } from '../simulation/controller';
import { audio } from '../app/audio';

/** Compact top-right control cluster. */
export function SceneControls() {
  const playing = usePlayback((s) => s.playing);
  const speed = usePlayback((s) => s.speed);
  const effective = usePlayback((s) => s.effectiveSpeed);
  const autoDemo = useUi((s) => s.autoDemo);
  const scene = useUi((s) => s.scene);
  const muted = useUi((s) => s.muted);
  const debugOpen = useUi((s) => s.debugOpen);
  const stationWorker = useUi((s) => s.stationWorkerId);
  const selected = useUi((s) => s.selectedWorkerId);

  return (
    <nav className="scene-controls" aria-label="Scene controls">
      <button
        type="button"
        className={`chip-btn demo ${autoDemo ? 'on' : ''}`}
        aria-pressed={autoDemo}
        onClick={() => {
          if (autoDemo) useUi.setState({ autoDemo: false });
          else if (engine.finished) replay();
          else useUi.setState({ autoDemo: true });
        }}
        title="Auto demo (cinematic replay of the run)"
      >
        <i className="rec" /> AUTO DEMO
      </button>
      <div className="seg" role="group" aria-label="Playback">
        <button
          type="button"
          className="seg-btn"
          onClick={() => usePlayback.getState().togglePlaying()}
          aria-label={playing ? 'Pause simulation (Space)' : 'Play simulation (Space)'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`seg-btn ${!autoDemo && speed === s ? 'on' : ''}`}
            onClick={() => {
              takeManualControl();
              usePlayback.setState({ speed: s, playing: true });
            }}
            aria-label={`Speed ${s}x`}
          >
            {s}x
          </button>
        ))}
        {autoDemo && <span className="seg-readout">{effective >= 10 ? Math.round(effective) : effective.toFixed(1)}x</span>}
      </div>
      <div className="seg" role="group" aria-label="View">
        <button
          type="button"
          className={`seg-btn ${scene === 'city' ? 'on' : ''}`}
          onClick={() => {
            takeManualControl();
            goToScene('city');
          }}
        >
          CITY
        </button>
        <button
          type="button"
          className={`seg-btn ${scene === 'station' ? 'on' : ''}`}
          onClick={() => {
            takeManualControl();
            goToScene('station', selected ?? stationWorker);
          }}
        >
          STATION
        </button>
      </div>
      <button type="button" className="icon-btn" onClick={() => resetCamera()} aria-label="Reset camera" title="Reset camera (R)">
        ⟲
      </button>
      <button
        type="button"
        className={`icon-btn ${muted ? '' : 'on'}`}
        onClick={() => {
          const next = !muted;
          useUi.setState({ muted: next });
          if (!next) audio.unlock();
        }}
        aria-label={muted ? 'Unmute sound (M)' : 'Mute sound (M)'}
        aria-pressed={!muted}
        title="Sound (M)"
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <button
        type="button"
        className={`icon-btn ${debugOpen ? 'on' : ''}`}
        onClick={() => useUi.setState({ debugOpen: !debugOpen })}
        aria-label="Simulation controls"
        aria-expanded={debugOpen}
        title="Simulation controls (`)"
      >
        ⚙
      </button>
    </nav>
  );
}
